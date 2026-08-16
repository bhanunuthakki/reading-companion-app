import { describe, it, expect } from "vitest";
import { SessionManager } from "../src/sessionManager";
import { InMemorySessionStore } from "../src/sessionStore";
import { WatcherEngine } from "../src/watcherEngine";
import type { ContentRef, PageText } from "../src/types";

const bookRef: ContentRef = { kind: "book", title: "Thinking, Fast and Slow", author: "Kahneman" };
const podcastRef: ContentRef = { kind: "podcast", title: "Conversations with Tyler", episodeGuid: "ep-42" };

function page(n: number, text: string): PageText {
  return { pageNumber: n, confidence: 1, paragraphs: [{ text, isHeading: false, isDialogue: false }] };
}

describe("SessionManager", () => {
  it("opens a fresh session, then resumes it with history intact", async () => {
    const store = new InMemorySessionStore();

    const first = await SessionManager.open(bookRef, store, "phone");
    expect(first.resumed).toBe(false);
    first.begin();
    first.addTurn("who?", { text: "An author.", citations: [] });
    await first.persist();

    const second = await SessionManager.open(bookRef, store, "glasses");
    expect(second.resumed).toBe(true);
    expect(second.current.turns).toHaveLength(1);
    expect(second.current.lastDeviceId).toBe("glasses");
  });

  it("engages as reading for visual content and listening for audio", async () => {
    const store = new InMemorySessionStore();
    const book = await SessionManager.open(bookRef, store);
    book.begin();
    expect(book.current.state).toBe("reading");

    const pod = await SessionManager.open(podcastRef, store);
    pod.begin();
    expect(pod.current.state).toBe("listening");
  });

  it("advances a page cursor for visual content", async () => {
    const store = new InMemorySessionStore();
    const m = await SessionManager.open(bookRef, store);
    m.observePage(page(42, "On attention and effort."));
    expect(m.current.cursor).toEqual({ type: "page", pageId: "p42", paragraphIdx: 0, charOffset: 0 });
  });

  it("rejects page observation on audio content", async () => {
    const store = new InMemorySessionStore();
    const m = await SessionManager.open(podcastRef, store);
    expect(() => m.observePage(page(1, "x"))).toThrow();
  });

  it("advances a time cursor for audio content", async () => {
    const store = new InMemorySessionStore();
    const m = await SessionManager.open(podcastRef, store);
    m.advanceAudio(930);
    expect(m.current.cursor).toEqual({ type: "time", offsetSeconds: 930 });
  });

  it("pauses for a question and resumes", async () => {
    const store = new InMemorySessionStore();
    const m = await SessionManager.open(bookRef, store);
    m.begin();
    m.pauseForQuestion();
    expect(m.current.state).toBe("paused_q");
    m.resume();
    expect(m.current.state).toBe("reading");
  });

  it("arms and fires watchers", async () => {
    const store = new InMemorySessionStore();
    const m = await SessionManager.open(bookRef, store);
    const w = m.addWatcher("spotlight effect");
    expect(m.current.watchers[0]?.status).toBe("armed");
    m.fireWatcher(w.id, "page 184");
    expect(m.current.watchers[0]?.status).toBe("fired");
    expect(m.current.watchers[0]?.firedLocation).toBe("page 184");
  });
});

describe("WatcherEngine", () => {
  const engine = new WatcherEngine();

  it("fires when every topic keyword appears in the text", () => {
    const matches = engine.check(
      [{ id: "w1", topic: "spotlight effect", createdAt: "t", status: "armed" }],
      "Here she returns to the spotlight effect once more.",
      "page 184",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.location).toBe("page 184");
  });

  it("does not fire on unrelated text", () => {
    const matches = engine.check(
      [{ id: "w1", topic: "spotlight effect", createdAt: "t", status: "armed" }],
      "A chapter about anchoring and adjustment.",
      "page 90",
    );
    expect(matches).toHaveLength(0);
  });

  it("ignores watchers that are not armed", () => {
    const matches = engine.check(
      [{ id: "w1", topic: "spotlight effect", createdAt: "t", status: "fired" }],
      "the spotlight effect again",
      "page 200",
    );
    expect(matches).toHaveLength(0);
  });
});
