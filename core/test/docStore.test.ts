import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileDocStore } from "../src/docStore";

interface Doc {
  id: string;
  value: string;
}

const docParser = {
  parse(data: unknown): Doc {
    const d = data as Doc;
    if (typeof d?.id !== "string" || typeof d?.value !== "string") {
      throw new Error("invalid doc");
    }
    return d;
  },
};

const created: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `rc-docs-${randomUUID()}`);
  created.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (created.length) {
    const dir = created.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

function eperm(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("EPERM: operation not permitted, rename");
  err.code = "EPERM";
  return err;
}

describe("FileDocStore transient-lock retry", () => {
  it("survives EPERM on rename that clears within the retry window", async () => {
    const store = new FileDocStore<Doc>(await tmpDir(), docParser);
    const realRename = fs.rename.bind(fs);
    let failures = 2;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (failures > 0) {
        failures -= 1;
        throw eperm();
      }
      return realRename(from, to);
    });

    await store.save({ id: "a", value: "survives lock" });
    expect((await store.load("a"))?.value).toBe("survives lock");
    expect(failures).toBe(0);
  });

  it("still fails loud when the lock never clears", async () => {
    const store = new FileDocStore<Doc>(await tmpDir(), docParser);
    vi.spyOn(fs, "rename").mockRejectedValue(eperm());

    await expect(store.save({ id: "b", value: "x" })).rejects.toThrow(/EPERM/);
  });

  it("does not retry non-transient errors", async () => {
    const store = new FileDocStore<Doc>(await tmpDir(), docParser);
    const boom = new Error("disk on fire");
    const spy = vi.spyOn(fs, "rename").mockRejectedValue(boom);

    await expect(store.save({ id: "c", value: "x" })).rejects.toThrow("disk on fire");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
