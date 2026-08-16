import { describe, it, expect } from "vitest";
import { LexicalMemoryIndex, seedMemoryIndex } from "../src/memoryIndex";
import { InMemoryThreadStore } from "../src/threadStore";
import { InMemoryJobStore } from "../src/jobStore";
import { InMemoryCaptureStore, OFFLINE_EXTRACTION_MARKER } from "../src/capture";
import { newThread } from "../src/types";

function seeded(): LexicalMemoryIndex {
  const index = new LexicalMemoryIndex();
  index.add({
    threadId: "thread-memory",
    kind: "digest",
    text: "Spaced repetition outperforms massed rereading for long-term retention across dozens of studies.",
  });
  index.add({
    threadId: "thread-cooking",
    kind: "turn",
    text: "Maillard reaction browning happens fastest above 140 degrees celsius.",
  });
  index.add({
    threadId: "thread-memory",
    kind: "capture",
    text: "Whiteboard notes about retrieval practice and the testing effect.",
  });
  return index;
}

describe("LexicalMemoryIndex", () => {
  it("ranks the on-topic entry first across threads", () => {
    const hits = seeded().search("spaced repetition retention");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.threadId).toBe("thread-memory");
    expect(hits[0]?.kind).toBe("digest");
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("indexes digests, turns, and capture extracts alike", () => {
    const hits = seeded().search("maillard browning");
    expect(hits[0]?.kind).toBe("turn");
    expect(hits[0]?.threadId).toBe("thread-cooking");
  });

  it("respects k and omits zero-overlap entries", () => {
    const index = seeded();
    expect(index.search("retrieval practice testing", 1)).toHaveLength(1);
    expect(index.search("quantum chromodynamics")).toEqual([]);
  });

  it("returns empty results for an empty query or an empty index", () => {
    expect(new LexicalMemoryIndex().search("anything")).toEqual([]);
    expect(seeded().search("   ")).toEqual([]);
  });

  it("truncates long snippets at a word boundary", () => {
    const index = new LexicalMemoryIndex();
    index.add({ threadId: "t", kind: "digest", text: `unique ${"filler words repeated ".repeat(30)}` });
    const hit = index.search("unique")[0];
    expect(hit).toBeDefined();
    expect(hit!.snippet.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(hit!.snippet.endsWith("…")).toBe(true);
  });
});

describe("seedMemoryIndex", () => {
  it("rebuilds from the durable stores, skipping offline markers and unfiled captures", async () => {
    const threads = new InMemoryThreadStore();
    const jobs = new InMemoryJobStore();
    const captures = new InMemoryCaptureStore();

    const thread = newThread("seeding");
    thread.turns.push({
      id: "turn-1",
      at: new Date().toISOString(),
      question: "what is anchoring bias?",
      answer: { text: "A judgment pulled toward an initial value.", citations: [] },
    });
    await threads.save(thread);

    const now = new Date().toISOString();
    await jobs.save({
      id: "job-1",
      threadId: thread.id,
      question: "literature on anchoring",
      captureIds: [],
      state: "digest_ready",
      budget: { maxTokens: 1000, maxSeconds: 60 },
      createdAt: now,
      updatedAt: now,
      invited: false,
      digest: { tldr: "Anchoring is robust.", body: "Many replications.", citations: [], confidence: 0.9, followups: [] },
    });
    await captures.save({ id: "cap-1", source: "phoneCamera", kind: "scene", extract: OFFLINE_EXTRACTION_MARKER, ts: now, threadId: thread.id });
    await captures.save({ id: "cap-2", source: "phoneCamera", kind: "whiteboard", extract: "unattached whiteboard", ts: now });

    const index = new LexicalMemoryIndex();
    const count = await seedMemoryIndex(index, { threads, jobs, captures });
    expect(count).toBe(2); // one turn + one digest; marker and unfiled captures skipped
    expect(index.search("anchoring")[0]?.threadId).toBe(thread.id);
  });
});
