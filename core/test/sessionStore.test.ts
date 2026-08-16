import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileSessionStore } from "../src/sessionStore";
import { newSession, type ContentRef } from "../src/types";

const created: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `rc-store-${randomUUID()}`);
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

const bookRef: ContentRef = { kind: "book", title: "Thinking, Fast and Slow", author: "Daniel Kahneman" };
const podcastRef: ContentRef = { kind: "podcast", title: "Conversations with Tyler", episodeGuid: "ep-42" };

describe("FileSessionStore", () => {
  it("round-trips a saved session by ref", async () => {
    const store = new FileSessionStore(await tmpDir());
    const session = newSession(bookRef, "device-a");
    session.turns.push({
      id: "t1",
      at: new Date().toISOString(),
      question: "Who is being discussed?",
      answer: { text: "An author.", citations: [] },
    });
    const saved = await store.save(session);

    const loaded = await store.load(bookRef);
    expect(loaded).not.toBeNull();
    expect(loaded?.ref.title).toBe(bookRef.title);
    expect(loaded?.turns).toHaveLength(1);
    expect(loaded?.updatedAt).toBe(saved.updatedAt);
  });

  it("returns null for an unknown ref", async () => {
    const store = new FileSessionStore(await tmpDir());
    expect(await store.load(bookRef)).toBeNull();
  });

  it("stamps updatedAt on save", async () => {
    const store = new FileSessionStore(await tmpDir());
    const session = newSession(bookRef);
    const before = session.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const saved = await store.save(session);
    expect(saved.updatedAt >= before).toBe(true);
  });

  it("lists saved sessions newest-first", async () => {
    const store = new FileSessionStore(await tmpDir());
    await store.save(newSession(bookRef));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.save(newSession(podcastRef));

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.ref.kind).toBe("podcast"); // most recently saved
  });

  it("removes a session", async () => {
    const store = new FileSessionStore(await tmpDir());
    await store.save(newSession(bookRef));
    await store.remove(bookRef);
    expect(await store.load(bookRef)).toBeNull();
  });

  it("resumes cursor + watchers from a fresh store on the same dir (days-later / cross-device)", async () => {
    const dir = await tmpDir();
    const writer = new FileSessionStore(dir);
    const session = newSession(podcastRef, "phone");
    session.cursor = { type: "time", offsetSeconds: 1234 };
    session.watchers.push({
      id: "w1",
      topic: "spotlight effect",
      createdAt: new Date().toISOString(),
      status: "armed",
    });
    await writer.save(session);

    // A different store instance == a different device hitting the same Core store.
    const reader = new FileSessionStore(dir);
    const loaded = await reader.load(podcastRef);
    expect(loaded?.cursor).toEqual({ type: "time", offsetSeconds: 1234 });
    expect(loaded?.watchers[0]?.topic).toBe("spotlight effect");
  });
});
