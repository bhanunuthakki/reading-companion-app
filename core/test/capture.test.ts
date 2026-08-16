import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileCaptureStore, OfflineCaptureExtractor, OFFLINE_EXTRACTION_MARKER } from "../src/capture";
import type { Capture } from "../src/types";

const created: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `rc-captures-${randomUUID()}`);
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length) {
    const dir = created.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("OfflineCaptureExtractor", () => {
  const extractor = new OfflineCaptureExtractor();

  it("honors the hinted kind and never fabricates content", async () => {
    const result = await extractor.extract("data:image/jpeg;base64,AAAA", "whiteboard");
    expect(result.kind).toBe("whiteboard");
    expect(result.extract).toBe(OFFLINE_EXTRACTION_MARKER);
  });

  it("defaults to kind scene without a hint", async () => {
    const result = await extractor.extract("AAAA");
    expect(result.kind).toBe("scene");
    expect(result.extract).toBe(OFFLINE_EXTRACTION_MARKER);
  });
});

describe("FileCaptureStore", () => {
  it("round-trips a capture and persists no image bytes", async () => {
    const dir = await tmpDir();
    const store = new FileCaptureStore(dir);
    const capture: Capture = {
      id: randomUUID(),
      source: "glassesCamera",
      kind: "page",
      extract: "On attention and effort.",
      ts: new Date().toISOString(),
      threadId: "thread-1",
    };
    await store.save(capture);

    const loaded = await store.load(capture.id);
    expect(loaded).toEqual(capture);

    // Privacy (spec §9): the document on disk contains the extract, never an image field.
    const raw = await fs.readFile(path.join(dir, `${capture.id}.json`), "utf8");
    expect(raw).toContain("On attention and effort.");
    expect(raw).not.toMatch(/image|frame|base64/i);
  });

  it("lists captures newest first and removes them", async () => {
    const store = new FileCaptureStore(await tmpDir());
    const older: Capture = { id: "a", source: "phoneCamera", kind: "scene", extract: "x", ts: "2026-01-01T00:00:00Z" };
    const newer: Capture = { id: "b", source: "phoneCamera", kind: "scene", extract: "y", ts: "2026-06-01T00:00:00Z" };
    await store.save(older);
    await store.save(newer);
    expect((await store.list()).map((c) => c.id)).toEqual(["b", "a"]);
    await store.remove("b");
    expect(await store.load("b")).toBeNull();
    expect(await store.load("a")).not.toBeNull();
  });
});
