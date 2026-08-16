import { describe, it, expect } from "vitest";
import { SessionConnection, type ServerMessage, type ThoughtPartnerDeps } from "../src/connection";
import { InMemorySessionStore } from "../src/sessionStore";
import { MockVoiceSession } from "../src/voice/mock";
import { MockResearchProvider } from "../src/research/dispatcher";
import { InMemoryThreadStore } from "../src/threadStore";
import { InMemoryJobStore } from "../src/jobStore";
import { InMemoryCaptureStore, OfflineCaptureExtractor, OFFLINE_EXTRACTION_MARKER } from "../src/capture";
import { WorkQueue } from "../src/workQueue";
import { HeuristicTriageProvider } from "../src/triage";
import { DeliveryEngine } from "../src/deliveryEngine";
import { LexicalMemoryIndex } from "../src/memoryIndex";
import type { JobState } from "../src/types";

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface Rig {
  sent: ServerMessage[];
  conn: SessionConnection;
  partner: ThoughtPartnerDeps;
  jobStore: InMemoryJobStore;
  of: <T extends ServerMessage["type"]>(type: T) => Array<Extract<ServerMessage, { type: T }>>;
  jobStates: () => JobState[];
}

function setup(overrides: Partial<ThoughtPartnerDeps> = {}, digestDelayMs = 0): Rig {
  const sent: ServerMessage[] = [];
  const research = new MockResearchProvider({ digestDelayMs });
  const jobStore = new InMemoryJobStore();
  const partner: ThoughtPartnerDeps = {
    threads: new InMemoryThreadStore(),
    captures: new InMemoryCaptureStore(),
    workQueue: new WorkQueue({ jobs: jobStore, provider: research }),
    triage: new HeuristicTriageProvider(),
    deliveryEngine: new DeliveryEngine(),
    captureExtractor: new OfflineCaptureExtractor(),
    memory: new LexicalMemoryIndex(),
    deviceHasDisplay: true,
    ...overrides,
  };
  const conn = new SessionConnection({
    store: new InMemorySessionStore(),
    voice: new MockVoiceSession(),
    research,
    send: (m) => sent.push(m),
    thoughtPartner: partner,
  });
  const of = <T extends ServerMessage["type"]>(type: T) =>
    sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { sent, conn, partner, jobStore, of, jobStates: () => of("job_update").map((m) => m.state) };
}

const BACKGROUND_Q = "what does the literature say about spaced repetition?";

describe("WS protocol v2 (offline end-to-end)", () => {
  it("stores a capture with the hinted kind and the offline marker — image discarded", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "capture", imageBase64: "AAAA", hintKind: "whiteboard" });

    const stored = of("capture_stored");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.kind).toBe("whiteboard");
    const capture = await partner.captures.load(stored[0]!.captureId);
    expect(capture?.extract).toBe(OFFLINE_EXTRACTION_MARKER);
    expect(capture && Object.keys(capture)).not.toContain("imageBase64");
  });

  it("routes a short question fast: ask_routed carries the Answer and a Turn is recorded", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "ask", question: "what does 'inchoate' mean?" });

    const routed = of("ask_routed");
    expect(routed).toHaveLength(1);
    expect(routed[0]?.route).toBe("fast");
    expect(routed[0]?.answer?.text).toContain("inchoate");
    expect(routed[0]?.jobId).toBeUndefined();

    const thread = await partner.threads.load(routed[0]!.threadId);
    expect(thread?.turns).toHaveLength(1);
    expect(partner.memory.search("inchoate")[0]?.threadId).toBe(thread?.id);
  });

  it("routes a research question background: job_update sequence then deliver (badge on a worn display)", async () => {
    const { conn, partner, jobStore, of, jobStates } = setup();
    await conn.handle({ type: "wear", worn: true });
    await conn.handle({ type: "ask", question: BACKGROUND_Q });

    const routed = of("ask_routed")[0];
    expect(routed?.route).toBe("background");
    expect(routed?.jobId).toBeTruthy();

    await partner.workQueue.whenIdle();
    await waitFor(() => of("deliver").length === 1 && jobStates().includes("delivered"));

    expect(jobStates()).toEqual(["queued", "running", "digest_ready", "delivered"]);
    const deliver = of("deliver")[0]!;
    expect(deliver.jobId).toBe(routed!.jobId);
    expect(deliver.level).toBe("badge"); // rule 3 default: uninvited completion on a display device
    expect(deliver.surface).toBe("glasses");
    expect(deliver.tldr).toContain("Mock digest");
    expect(deliver.badge!.length).toBeLessThanOrEqual(140);

    const thread = await partner.threads.load(routed!.threadId);
    expect(thread?.jobIds).toContain(routed!.jobId);
    expect(thread?.digestIds).toContain(routed!.jobId);
    expect((await jobStore.load(routed!.jobId!))?.state).toBe("delivered");
    expect(partner.memory.search("spaced repetition")[0]?.kind).toBe("digest");
  });

  it("upgrades an invited job to speak (rule 4) via the spoken invitation", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "wear", worn: true });
    await conn.handle({ type: "ask", question: `${BACKGROUND_Q} tell me when you're back` });
    await partner.workQueue.whenIdle();
    await waitFor(() => of("deliver").length === 1);
    expect(of("deliver")[0]?.level).toBe("speak");
  });

  it("holds to the phone when no wear signal was ever received (rule 2)", async () => {
    const { conn, partner, jobStore, of } = setup();
    await conn.handle({ type: "ask", question: BACKGROUND_Q });
    await partner.workQueue.whenIdle();
    await waitFor(() => of("deliver").length === 1);

    expect(of("deliver")[0]).toMatchObject({ level: "hold", surface: "phone" });
    // A held digest is NOT marked delivered — it waits in its Thread.
    const jobId = of("ask_routed")[0]!.jobId!;
    expect((await jobStore.load(jobId))?.state).toBe("digest_ready");
  });

  it("cancels a background job: job_update archived, no deliver", async () => {
    const { conn, partner, of } = setup({}, 150);
    await conn.handle({ type: "wear", worn: true });
    await conn.handle({ type: "ask", question: BACKGROUND_Q });
    const jobId = of("ask_routed")[0]!.jobId!;

    await conn.handle({ type: "job_cancel", jobId });
    await partner.workQueue.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 200)); // let the discarded result surface if it were going to

    expect(of("job_update").map((m) => m.state)).toContain("archived");
    expect(of("deliver")).toEqual([]);
    expect(of("error")).toEqual([]);
  });

  it("attaches an existing capture to the ask's thread and job", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "capture", imageBase64: "AAAA", hintKind: "document" });
    const captureId = of("capture_stored")[0]!.captureId;

    await conn.handle({ type: "ask", question: BACKGROUND_Q, captureId });
    const routed = of("ask_routed")[0]!;
    await partner.workQueue.whenIdle();

    expect((await partner.captures.load(captureId))?.threadId).toBe(routed.threadId);
    const job = partner.workQueue.get(routed.jobId!);
    expect(job?.captureIds).toEqual([captureId]);
  });

  it("continues an existing thread when threadId is given", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "ask", question: "define anchoring" });
    const threadId = of("ask_routed")[0]!.threadId;
    await conn.handle({ type: "ask", question: "define adjustment", threadId });

    expect(of("ask_routed")[1]?.threadId).toBe(threadId);
    expect((await partner.threads.load(threadId))?.turns).toHaveLength(2);
  });

  it("fails loudly on an unknown threadId or captureId", async () => {
    const { conn, of } = setup();
    await conn.handle({ type: "ask", question: "hello", threadId: "missing" });
    await conn.handle({ type: "ask", question: "hello", captureId: "missing" });
    expect(of("error")).toHaveLength(2);
    expect(of("ask_routed")).toEqual([]);
  });

  it("errors on v2 messages when thought-partner modules are not configured", async () => {
    const sent: ServerMessage[] = [];
    const conn = new SessionConnection({
      store: new InMemorySessionStore(),
      voice: new MockVoiceSession(),
      research: new MockResearchProvider(),
      send: (m) => sent.push(m),
    });
    await conn.handle({ type: "ask", question: "anything" });
    expect(sent).toEqual([{ type: "error", message: "Thought-partner modules are not configured on this server." }]);
  });

  it("stops forwarding job updates after end (unsubscribe)", async () => {
    const { conn, partner, of } = setup();
    await conn.handle({ type: "end" });
    await partner.workQueue.submit({ threadId: "t", question: "background things about the literature" });
    await partner.workQueue.whenIdle();
    expect(of("job_update")).toEqual([]);
  });
});
