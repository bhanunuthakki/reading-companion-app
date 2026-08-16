/**
 * SessionConnection — the per-client orchestration that ties the whole core
 * together, independent of transport. The server adapts a WebSocket to it; tests
 * drive it directly with a `send` capture, which is how the end-to-end loop is
 * verified fully offline (mock voice + mock research).
 *
 * Message flow (v1 — reading session):
 *   open  → open/resume the session, wire the voice session, kick enrichment
 *   say   → typed question → research → answer + recorded turn   (client-STT path)
 *   page  → OCR a frame → advance the page cursor → feed the voice model
 *   mic   → stream audio to the live voice model      (spoken path)
 *   frame → stream a camera frame to the live voice model
 *   watch → arm a standing watcher
 *   end   → close the session
 *
 * Message flow (v2 — thought partner; needs `thoughtPartner` deps, no open required):
 *   ask        → triage → fast Answer (ask_routed) or background ResearchJob
 *   capture    → classify + extract → Capture persisted (image discarded) → capture_stored
 *   job_cancel → WorkQueue.cancel → job_update "archived"
 *   wear       → wear-state for the DeliveryEngine (rule 2)
 * Job transitions stream back as job_update; digest_ready additionally runs the
 * DeliveryEngine and emits deliver. NOTE: the job_update for state "queued" is
 * emitted during submission and therefore arrives BEFORE ask_routed.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Capture,
  CaptureKind,
  ContentRef,
  DeliveryPolicy,
  newThread,
  type Answer,
  type CaptureSource,
  type Cursor,
  type DndWindow,
  type InterruptLevel,
  type JobState,
  type ResearchJob,
  type Session,
  type Thread,
  type Watcher,
} from "./types";
import type { SessionStore } from "./sessionStore";
import { SessionManager } from "./sessionManager";
import type { VoiceSession } from "./voice/voiceSession";
import type { ResearchProvider } from "./research/dispatcher";
import { ToolDispatcher, READING_COMPANION_SYSTEM_PROMPT, READING_COMPANION_TOOLS } from "./research/tools";
import type { OcrClient } from "./imagePipeline/ocr";
import type { ContentEnricher } from "./content/enricher";
import type { ThreadStore } from "./threadStore";
import { OFFLINE_EXTRACTION_MARKER, type CaptureExtractor, type CaptureStore } from "./capture";
import type { JobTransition, WorkQueue } from "./workQueue";
import type { TriageProvider, TriageRoute } from "./triage";
import { CONVERSATION_WINDOW_MS, type DeliveryEngine, type DeliverySurface } from "./deliveryEngine";
import type { MemoryIndex } from "./memoryIndex";
import { redactSecrets } from "./redact";

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("open"), ref: ContentRef, deviceId: z.string().optional() }),
  z.object({ type: z.literal("say"), question: z.string() }),
  z.object({ type: z.literal("page"), imageBase64: z.string() }),
  z.object({ type: z.literal("mic"), pcmBase64: z.string() }),
  z.object({ type: z.literal("frame"), jpegBase64: z.string() }),
  z.object({ type: z.literal("watch"), topic: z.string() }),
  z.object({ type: z.literal("end") }),
  // ── WS protocol v2 (thought partner) ──
  z.object({
    type: z.literal("ask"),
    question: z.string().min(1),
    captureId: z.string().optional(),
    threadId: z.string().optional(),
  }),
  z.object({
    type: z.literal("capture"),
    imageBase64: z.string().min(1),
    hintKind: CaptureKind.optional(),
    threadId: z.string().optional(),
  }),
  z.object({ type: z.literal("job_cancel"), jobId: z.string() }),
  z.object({ type: z.literal("wear"), worn: z.boolean() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ServerMessage =
  | { type: "opened"; session: Session; resumed: boolean }
  | { type: "audio"; audioBase64: string; mimeType: string }
  | { type: "transcript"; role: "user" | "model"; text: string }
  | { type: "answer"; answer: Answer }
  | { type: "page_observed"; cursor: Cursor }
  | { type: "watcher_armed"; watcher: Watcher }
  | { type: "error"; message: string }
  // ── WS protocol v2 (thought partner) ──
  | { type: "ask_routed"; route: TriageRoute; threadId: string; jobId?: string; answer?: Answer }
  | { type: "capture_stored"; captureId: string; kind: CaptureKind }
  | { type: "job_update"; jobId: string; state: JobState }
  | { type: "deliver"; level: InterruptLevel; surface: DeliverySurface; jobId: string; tldr?: string; badge?: string };

/**
 * Everything the thought-partner loop needs. Built once by the server and
 * shared across connections (stores, WorkQueue, and DeliveryEngine are
 * process-wide singletons; wear state and conversation detection are per-
 * connection inside SessionConnection).
 */
export interface ThoughtPartnerDeps {
  threads: ThreadStore;
  captures: CaptureStore;
  workQueue: WorkQueue;
  triage: TriageProvider;
  deliveryEngine: DeliveryEngine;
  captureExtractor: CaptureExtractor;
  memory: MemoryIndex;
  /** Global DND windows (DeliveryPolicy). Default: none. */
  dndWindows?: DndWindow[];
  /** Etiquette rule 1 flag. Default: true. */
  suppressWhileConversing?: boolean;
  /** Display glasses vs audio-only (rule 3 defaults). Default: true. */
  deviceHasDisplay?: boolean;
  /** Which camera this connection's captures come from. Default: "phoneCamera". */
  captureSource?: CaptureSource;
}

export interface ConnectionDeps {
  store: SessionStore;
  voice: VoiceSession;
  research: ResearchProvider;
  send: (msg: ServerMessage) => void;
  ocr?: OcrClient;
  enricher?: ContentEnricher;
  thoughtPartner?: ThoughtPartnerDeps;
}

/** Rule 4 — the documented spoken-invitation heuristic ("tell me when you're back"). */
const INVITATION_RE = /\btell me when\b|\blet me know when\b|\bwhen you(?:'| a)re back\b/i;

/** Digests below this confidence count as uncertain (etiquette rule 5). */
const UNCERTAIN_DIGEST_CONFIDENCE = 0.4;

/** Glasses card grammar: badge text is a TLDR of at most 140 characters. */
const BADGE_MAX_CHARS = 140;

function badgeOf(tldr: string): string {
  return tldr.length <= BADGE_MAX_CHARS ? tldr : `${tldr.slice(0, BADGE_MAX_CHARS - 1)}…`;
}

function threadTopicOf(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return flat;
  const cut = flat.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : 80)}…`;
}

function briefOf(manager: SessionManager): string | undefined {
  const dossier = manager.current.dossier;
  if (!dossier) return undefined;
  return dossier.themes.length ? `${dossier.summary} Themes: ${dossier.themes.join(", ")}.` : dossier.summary;
}

function messageOf(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}

export class SessionConnection {
  private manager: SessionManager | null = null;
  private dispatcher: ToolDispatcher | null = null;
  /** Rule 2: no wear signal ever received means not worn. */
  private worn = false;
  /** Epoch ms of the last detected user speech (rule 1's conversation window). */
  private lastUserSpeechAt: number | null = null;
  private unsubscribeJobs: (() => void) | null = null;

  constructor(private readonly deps: ConnectionDeps) {
    if (deps.thoughtPartner) {
      this.unsubscribeJobs = deps.thoughtPartner.workQueue.onTransition((transition) =>
        void this.onJobTransition(transition),
      );
    }
  }

  /** Inspect the live session (tests, server status). */
  get currentSession(): Session | null {
    return this.manager?.current ?? null;
  }

  async handle(raw: unknown): Promise<void> {
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      this.deps.send({ type: "error", message: "Invalid message." });
      return;
    }
    const msg = parsed.data;
    try {
      switch (msg.type) {
        case "open":
          await this.open(msg.ref, msg.deviceId);
          break;
        case "say":
          await this.say(msg.question);
          break;
        case "page":
          await this.page(msg.imageBase64);
          break;
        case "mic":
          this.requireManager();
          this.deps.voice.pushMicAudio(msg.pcmBase64);
          break;
        case "frame":
          this.requireManager();
          this.deps.voice.pushCameraFrame(msg.jpegBase64);
          break;
        case "watch":
          await this.watch(msg.topic);
          break;
        case "end":
          await this.end();
          break;
        case "ask":
          await this.ask(msg);
          break;
        case "capture":
          await this.capture(msg);
          break;
        case "job_cancel":
          await this.requireThoughtPartner().workQueue.cancel(msg.jobId);
          break;
        case "wear":
          this.worn = msg.worn;
          break;
      }
    } catch (err) {
      this.deps.send({ type: "error", message: messageOf(err) });
    }
  }

  private async open(ref: z.infer<typeof ContentRef>, deviceId?: string): Promise<void> {
    const manager = await SessionManager.open(ref, this.deps.store, deviceId);
    this.manager = manager;
    this.dispatcher = new ToolDispatcher(manager, this.deps.research);

    this.deps.voice.onAudioOut((audioBase64, mimeType) =>
      this.deps.send({ type: "audio", audioBase64, mimeType }),
    );
    this.deps.voice.onTranscript((role, text) => this.deps.send({ type: "transcript", role, text }));
    this.deps.voice.onUserSpeechStart(() => {
      this.lastUserSpeechAt = Date.now();
      manager.pauseForQuestion();
    });
    this.deps.voice.onToolCall((call) => {
      if (!this.dispatcher) throw new Error("Tool call before session open.");
      return this.dispatcher.handle(call);
    });

    await this.deps.voice.start({
      systemPrompt: READING_COMPANION_SYSTEM_PROMPT,
      tools: READING_COMPANION_TOOLS,
    });
    manager.begin();
    await manager.persist();
    this.deps.send({ type: "opened", session: manager.current, resumed: manager.resumed });

    if (this.deps.enricher) void this.enrich(ref, manager);
  }

  private async enrich(ref: z.infer<typeof ContentRef>, manager: SessionManager): Promise<void> {
    try {
      const dossier = await this.deps.enricher!.build(ref);
      manager.attachDossier(dossier);
      await manager.persist();
    } catch (err) {
      this.deps.send({ type: "error", message: `enrichment failed: ${messageOf(err)}` });
    }
  }

  private async say(question: string): Promise<void> {
    const manager = this.requireManager();
    const brief = briefOf(manager);
    const answer = await this.deps.research.research({
      question,
      ...(brief ? { dossierBrief: brief } : {}),
    });
    manager.addTurn(question, answer);
    await manager.persist();
    this.deps.send({ type: "answer", answer });
  }

  private async page(imageBase64: string): Promise<void> {
    const manager = this.requireManager();
    if (!this.deps.ocr) throw new Error("OCR is not configured on this server (set GEMINI_API_KEY).");
    const pageText = await this.deps.ocr.ocrPage(imageBase64);
    manager.observePage(pageText);
    await this.deps.voice.pushPageText(pageText.paragraphs.map((p) => p.text).join("\n"));
    await manager.persist();
    this.deps.send({ type: "page_observed", cursor: manager.current.cursor });
  }

  private async watch(topic: string): Promise<void> {
    const manager = this.requireManager();
    const watcher = manager.addWatcher(topic);
    await manager.persist();
    this.deps.send({ type: "watcher_armed", watcher });
  }

  private async end(): Promise<void> {
    if (this.manager) {
      this.manager.end();
      await this.manager.persist();
    }
    this.unsubscribeJobs?.();
    this.unsubscribeJobs = null;
    await this.deps.voice.end();
  }

  // ── WS protocol v2 (thought partner) ───────────────────────────────────────

  /**
   * The core loop's TRIAGE step: fast → Answer now (spoken by the client);
   * background → ResearchJob on the WorkQueue ("on it — I'll come back").
   * Without a threadId a Thread is auto-created from the question (spec §12 Q2
   * default); an unattached capture is adopted by the chosen thread.
   */
  private async ask(msg: { question: string; captureId?: string; threadId?: string }): Promise<void> {
    const partner = this.requireThoughtPartner();

    let capture: Capture | null = null;
    if (msg.captureId) {
      capture = await partner.captures.load(msg.captureId);
      if (!capture) throw new Error(`No capture with id ${msg.captureId}.`);
    }

    let thread: Thread;
    if (msg.threadId) {
      const existing = await partner.threads.load(msg.threadId);
      if (!existing) throw new Error(`No thread with id ${msg.threadId}.`);
      thread = existing;
    } else {
      thread = await partner.threads.save(newThread(threadTopicOf(msg.question)));
    }

    if (capture && !capture.threadId) {
      capture.threadId = thread.id;
      capture = await partner.captures.save(capture);
    }
    // The offline marker is an absence, not content — never research over it.
    const captureExtract =
      capture && capture.extract !== OFFLINE_EXTRACTION_MARKER ? capture.extract : undefined;

    const decision = await partner.triage.triage({
      question: msg.question,
      ...(captureExtract ? { captureExtract } : {}),
    });

    if (decision.route === "fast") {
      const answer = await this.deps.research.research({
        question: msg.question,
        ...(captureExtract ? { pageText: captureExtract } : {}),
      });
      const turn = { id: randomUUID(), at: new Date().toISOString(), question: msg.question, answer };
      thread.turns.push(turn);
      thread = await partner.threads.save(thread);
      partner.memory.add({ threadId: thread.id, kind: "turn", text: `${msg.question} ${answer.text}`, ref: turn.id });
      this.deps.send({ type: "ask_routed", route: "fast", threadId: thread.id, answer });
      return;
    }

    const job = await partner.workQueue.submit({
      threadId: thread.id,
      question: msg.question,
      captureIds: capture ? [capture.id] : [],
      captureExtracts: captureExtract ? [captureExtract] : [],
      threadTopic: thread.topic,
      invited: INVITATION_RE.test(msg.question),
    });
    thread.jobIds.push(job.id);
    await partner.threads.save(thread);
    this.deps.send({ type: "ask_routed", route: "background", threadId: thread.id, jobId: job.id });
  }

  /**
   * The core loop's CAPTURE step. The image is handed to the extractor once and
   * discarded — the Capture schema has no image field, so only the extract (or
   * the explicit offline marker) persists (spec §9).
   */
  private async capture(msg: { imageBase64: string; hintKind?: CaptureKind; threadId?: string }): Promise<void> {
    const partner = this.requireThoughtPartner();
    if (msg.threadId && !(await partner.threads.load(msg.threadId))) {
      throw new Error(`No thread with id ${msg.threadId}.`);
    }
    const { kind, extract } = await partner.captureExtractor.extract(msg.imageBase64, msg.hintKind);
    const capture = Capture.parse({
      id: randomUUID(),
      source: partner.captureSource ?? "phoneCamera",
      kind,
      extract,
      ts: new Date().toISOString(),
      ...(msg.threadId ? { threadId: msg.threadId } : {}),
    });
    await partner.captures.save(capture);
    if (capture.threadId && extract !== OFFLINE_EXTRACTION_MARKER) {
      partner.memory.add({ threadId: capture.threadId, kind: "capture", text: extract, ref: capture.id });
    }
    this.deps.send({ type: "capture_stored", captureId: capture.id, kind: capture.kind });
  }

  /** Forward every job transition as job_update; digest_ready also runs the DeliveryEngine. */
  private async onJobTransition(transition: JobTransition): Promise<void> {
    const { job } = transition;
    this.deps.send({ type: "job_update", jobId: job.id, state: job.state });
    if (job.state !== "digest_ready") return;
    try {
      await this.deliverDigest(job);
    } catch (err) {
      this.deps.send({ type: "error", message: `delivery failed: ${messageOf(err)}` });
    }
  }

  /** The core loop's DELIVER + PERSIST steps for one completed ResearchJob. */
  private async deliverDigest(job: ResearchJob): Promise<void> {
    const partner = this.requireThoughtPartner();
    const digest = job.digest;
    if (!digest) throw new Error(`Job ${job.id} is digest_ready without a digest.`);

    const thread = await partner.threads.load(job.threadId);
    const policy = DeliveryPolicy.parse({
      ceiling: thread?.deliveryCeiling ?? "speak",
      dndWindows: partner.dndWindows ?? [],
      suppressWhileConversing: partner.suppressWhileConversing ?? true,
    });
    const decision = partner.deliveryEngine.decide({
      event: "job_completion",
      policy,
      worn: this.worn,
      deviceHasDisplay: partner.deviceHasDisplay ?? true,
      invited: job.invited,
      conversationDetected: this.conversationDetected(),
      uncertain: digest.confidence < UNCERTAIN_DIGEST_CONFIDENCE,
    });

    this.deps.send({
      type: "deliver",
      level: decision.level,
      surface: decision.surface,
      jobId: job.id,
      tldr: digest.tldr,
      badge: badgeOf(digest.tldr),
    });
    if (decision.level === "badge") partner.deliveryEngine.trackBadge(job.id);

    if (thread) {
      if (!thread.digestIds.includes(job.id)) thread.digestIds.push(job.id);
      await partner.threads.save(thread);
    }
    partner.memory.add({
      threadId: job.threadId,
      kind: "digest",
      text: `${digest.tldr} ${digest.body}`,
      ref: job.id,
    });
    // Held digests wait in their Thread (rule 6's phone fallback); everything louder counts as delivered.
    if (decision.level !== "hold") await partner.workQueue.markDelivered(job.id);
  }

  private conversationDetected(): boolean {
    return this.lastUserSpeechAt !== null && Date.now() - this.lastUserSpeechAt < CONVERSATION_WINDOW_MS;
  }

  private requireThoughtPartner(): ThoughtPartnerDeps {
    if (!this.deps.thoughtPartner) {
      throw new Error("Thought-partner modules are not configured on this server.");
    }
    return this.deps.thoughtPartner;
  }

  private requireManager(): SessionManager {
    if (!this.manager) throw new Error("Session not open; send an 'open' message first.");
    return this.manager;
  }
}
