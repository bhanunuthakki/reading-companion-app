import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileThreadStore, InMemoryThreadStore, type ThreadStore } from "../src/threadStore";
import { newThread } from "../src/types";

const created: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `rc-threads-${randomUUID()}`);
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function roundTripSuite(name: string, make: () => Promise<ThreadStore>): void {
  describe(name, () => {
    it("round-trips a saved thread by id", async () => {
      const store = await make();
      const thread = newThread("spaced repetition");
      thread.turns.push({
        id: "t1",
        at: new Date().toISOString(),
        question: "does it beat rereading?",
        answer: { text: "Yes, robustly.", citations: [] },
      });
      thread.jobIds.push("job-1");
      await store.save(thread);

      const loaded = await store.load(thread.id);
      expect(loaded?.topic).toBe("spaced repetition");
      expect(loaded?.turns).toHaveLength(1);
      expect(loaded?.jobIds).toEqual(["job-1"]);
    });

    it("returns null for an unknown id", async () => {
      const store = await make();
      expect(await store.load("nope")).toBeNull();
    });

    it("stamps updatedAt on save", async () => {
      const store = await make();
      const thread = newThread("x");
      const before = thread.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const saved = await store.save(thread);
      expect(saved.updatedAt > before).toBe(true);
    });

    it("lists summaries newest-first with counts", async () => {
      const store = await make();
      const older = newThread("older topic");
      older.digestIds.push("job-9");
      await store.save(older);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.save(newThread("newer topic"));

      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(list[0]?.topic).toBe("newer topic");
      expect(list[1]?.digestCount).toBe(1);
      expect(list[0]?.deliveryCeiling).toBe("speak");
    });

    it("removes a thread", async () => {
      const store = await make();
      const thread = newThread("gone");
      await store.save(thread);
      await store.remove(thread.id);
      expect(await store.load(thread.id)).toBeNull();
    });

    it("persists a changed deliveryCeiling", async () => {
      const store = await make();
      const thread = newThread("quiet topic");
      await store.save(thread);
      thread.deliveryCeiling = "badge";
      await store.save(thread);
      expect((await store.load(thread.id))?.deliveryCeiling).toBe("badge");
    });
  });
}

roundTripSuite("FileThreadStore", async () => new FileThreadStore(await tmpDir()));
roundTripSuite("InMemoryThreadStore", async () => new InMemoryThreadStore());

describe("FileThreadStore durability", () => {
  it("reads threads written by a previous store instance (days-later resume)", async () => {
    const dir = await tmpDir();
    const thread = newThread("cross-instance");
    await new FileThreadStore(dir).save(thread);

    const reader = new FileThreadStore(dir);
    expect((await reader.load(thread.id))?.topic).toBe("cross-instance");
    expect(await reader.all()).toHaveLength(1);
  });
});

describe("InMemoryThreadStore isolation", () => {
  it("returns copies so callers cannot mutate stored state", async () => {
    const store = new InMemoryThreadStore();
    const thread = newThread("immutable");
    await store.save(thread);
    const loaded = await store.load(thread.id);
    loaded?.jobIds.push("sneaky");
    expect((await store.load(thread.id))?.jobIds).toEqual([]);
  });
});
