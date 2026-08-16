/**
 * Generic JSON-document persistence shared by ThreadStore, JobStore, and
 * CaptureStore. Same pattern as FileSessionStore: one Zod-validated JSON file
 * per document, atomic tmp+rename writes, ENOENT mapped to null/[] — anything
 * else fails loudly. Deliberately internal plumbing: the domain stores compose
 * it and add their own summaries, sorting, and stamping.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

interface Identified {
  id: string;
}

/** Structural slice of a Zod schema — avoids threading Zod's generics through here. */
export interface DocParser<T> {
  parse(data: unknown): T;
}

export interface DocStore<T extends Identified> {
  /** The document with this id, or null if none exists. */
  load(id: string): Promise<T | null>;
  /** Validate + persist (applying `stamp` first, if configured). Returns the persisted copy. */
  save(doc: T): Promise<T>;
  /** Every document, in no guaranteed order — callers sort. */
  list(): Promise<T[]>;
  /** Forget a document. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

const TRANSIENT_FS_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const TRANSIENT_FS_ATTEMPTS = 5;

/**
 * Windows transiently locks files that another process (antivirus, Drive
 * sync, a concurrent reader) has open, failing rename/read with EPERM-class
 * codes that clear within milliseconds. Retry briefly, then fail loud.
 */
async function withTransientFsRetry<T>(op: () => Promise<T>): Promise<T> {
  let delayMs = 20;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === undefined || !TRANSIENT_FS_CODES.has(code) || attempt >= TRANSIENT_FS_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

/** Ids are UUIDs today; the guard keeps a hostile id from escaping the store dir. */
function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class FileDocStore<T extends Identified> implements DocStore<T> {
  constructor(
    private readonly dir: string,
    private readonly schema: DocParser<T>,
    private readonly stamp?: (doc: T) => T,
  ) {}

  private file(id: string): string {
    return path.join(this.dir, `${safeName(id)}.json`);
  }

  async load(id: string): Promise<T | null> {
    let raw: string;
    try {
      raw = await withTransientFsRetry(() => fs.readFile(this.file(id), "utf8"));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    return this.schema.parse(JSON.parse(raw));
  }

  async save(doc: T): Promise<T> {
    await fs.mkdir(this.dir, { recursive: true });
    const validated = this.schema.parse(this.stamp ? this.stamp(doc) : doc);
    const target = this.file(validated.id);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(validated, null, 2), "utf8");
    // atomic replace; never leaves a half-written doc
    await withTransientFsRetry(() => fs.rename(tmp, target));
    return validated;
  }

  async list(): Promise<T[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const docs: T[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(this.dir, name), "utf8");
      docs.push(this.schema.parse(JSON.parse(raw)));
    }
    return docs;
  }

  async remove(id: string): Promise<void> {
    try {
      await fs.unlink(this.file(id));
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

/** Non-durable store for tests. Deep copies in and out so callers can't mutate stored state. */
export class MemoryDocStore<T extends Identified> implements DocStore<T> {
  private readonly map = new Map<string, T>();

  constructor(
    private readonly schema: DocParser<T>,
    private readonly stamp?: (doc: T) => T,
  ) {}

  async load(id: string): Promise<T | null> {
    const found = this.map.get(id);
    return found ? structuredClone(found) : null;
  }

  async save(doc: T): Promise<T> {
    const validated = this.schema.parse(this.stamp ? this.stamp(doc) : doc);
    this.map.set(validated.id, structuredClone(validated));
    return validated;
  }

  async list(): Promise<T[]> {
    return [...this.map.values()].map((doc) => structuredClone(doc));
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}
