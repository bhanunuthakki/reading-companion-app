import { describe, it, expect } from "vitest";
import { SessionConnection, type ServerMessage } from "../src/connection";
import { InMemorySessionStore } from "../src/sessionStore";
import { MockVoiceSession } from "../src/voice/mock";
import { MockResearchProvider } from "../src/research/dispatcher";
import type { OcrClient } from "../src/imagePipeline/ocr";
import type { ContentRef, PageText } from "../src/types";

const bookRef: ContentRef = { kind: "book", title: "Thinking, Fast and Slow", author: "Kahneman" };

function setup(ocr?: OcrClient): {
  sent: ServerMessage[];
  store: InMemorySessionStore;
  voice: MockVoiceSession;
  conn: SessionConnection;
} {
  const sent: ServerMessage[] = [];
  const store = new InMemorySessionStore();
  const voice = new MockVoiceSession();
  const conn = new SessionConnection({
    store,
    voice,
    research: new MockResearchProvider(),
    send: (m) => sent.push(m),
    ...(ocr ? { ocr } : {}),
  });
  return { sent, store, voice, conn };
}

describe("SessionConnection (offline end-to-end)", () => {
  it("opens and persists a session", async () => {
    const { sent, store, conn } = setup();
    await conn.handle({ type: "open", ref: bookRef, deviceId: "phone" });
    expect(sent.some((m) => m.type === "opened")).toBe(true);
    expect(await store.load(bookRef)).not.toBeNull();
  });

  it("answers a typed question and records a turn", async () => {
    const { sent, conn } = setup();
    await conn.handle({ type: "open", ref: bookRef });
    await conn.handle({ type: "say", question: "who is being discussed?" });
    expect(sent.some((m) => m.type === "answer")).toBe(true);
    expect(conn.currentSession?.turns).toHaveLength(1);
  });

  it("arms a watcher", async () => {
    const { sent, conn } = setup();
    await conn.handle({ type: "open", ref: bookRef });
    await conn.handle({ type: "watch", topic: "spotlight effect" });
    expect(sent.some((m) => m.type === "watcher_armed")).toBe(true);
    expect(conn.currentSession?.watchers[0]?.topic).toBe("spotlight effect");
  });

  it("routes a model tool call to the dispatcher", async () => {
    const { voice, conn } = setup();
    await conn.handle({ type: "open", ref: bookRef });
    await voice.simulateToolCall({ id: "1", name: "watch", args: { topic: "anchoring" } });
    expect(conn.currentSession?.watchers.some((w) => w.topic === "anchoring")).toBe(true);
  });

  it("pauses for a question on barge-in", async () => {
    const { voice, conn } = setup();
    await conn.handle({ type: "open", ref: bookRef });
    voice.simulateUserSpeechStart();
    expect(conn.currentSession?.state).toBe("paused_q");
  });

  it("observes a page through OCR and advances the cursor", async () => {
    const ocr: OcrClient = {
      ocrPage: async (): Promise<PageText> => ({
        pageNumber: 5,
        confidence: 1,
        paragraphs: [{ text: "On attention.", isHeading: false, isDialogue: false }],
      }),
    };
    const { sent, conn } = setup(ocr);
    await conn.handle({ type: "open", ref: bookRef });
    await conn.handle({ type: "page", imageBase64: "data:image/jpeg;base64,AAAA" });
    expect(sent.some((m) => m.type === "page_observed")).toBe(true);
    expect(conn.currentSession?.cursor).toMatchObject({ type: "page", pageId: "p5" });
  });

  it("errors when a message arrives before open", async () => {
    const { sent, conn } = setup();
    await conn.handle({ type: "say", question: "hi" });
    expect(sent.some((m) => m.type === "error")).toBe(true);
  });

  it("rejects malformed messages", async () => {
    const { sent, conn } = setup();
    await conn.handle({ type: "nonsense" });
    expect(sent.some((m) => m.type === "error")).toBe(true);
  });
});
