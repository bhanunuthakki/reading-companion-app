/**
 * Durable, sync-ready persistence for sessions.
 *
 * One JSON document per Content, keyed by sessionKey(ref). This single store
 * satisfies all three resume scopes locked during grilling:
 *   - glances:       re-load the hot document within a sitting.
 *   - days-later:    documents persist on disk, keyed by stable ContentRef.
 *   - across-devices: both devices talk to the same Core instance and read the
 *                     same document; documents carry updatedAt + lastDeviceId so
 *                     a future cloud SessionStore can implement the same
 *                     interface and sync them. (Cross-title linkage is out of
 *                     scope for now but the per-document model leaves room.)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { Session, sessionKey, type ContentRef, type SessionState } from "./types";

export interface SessionSummary {
  key: string;
  ref: ContentRef;
  state: SessionState;
  updatedAt: string;
  turnCount: number;
}

export interface SessionStore {
  /** The session for this Content, or null if none has been started. */
  load(ref: ContentRef): Promise<Session | null>;
  /** Persist the session, stamping updatedAt. Returns the persisted copy. */
  save(session: Session): Promise<Session>;
  /** All sessions, newest activity first. */
  list(): Promise<SessionSummary[]>;
  /** Forget a session. No-op if it does not exist. */
  remove(ref: ContentRef): Promise<void>;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

function toSummary(s: Session): SessionSummary {
  return { key: s.key, ref: s.ref, state: s.state, updatedAt: s.updatedAt, turnCount: s.turns.length };
}

function assertKeyMatches(session: Session): void {
  if (session.key !== sessionKey(session.ref)) {
    throw new Error(
      `Session.key (${session.key}) does not match sessionKey(ref) (${sessionKey(session.ref)}).`,
    );
  }
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  private file(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async load(ref: ContentRef): Promise<Session | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(sessionKey(ref)), "utf8");
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    return Session.parse(JSON.parse(raw));
  }

  async save(session: Session): Promise<Session> {
    assertKeyMatches(session);
    await fs.mkdir(this.dir, { recursive: true });
    const validated = Session.parse({ ...session, updatedAt: new Date().toISOString() });
    const target = this.file(validated.key);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(validated, null, 2), "utf8");
    await fs.rename(tmp, target); // atomic replace; never leaves a half-written doc
    return validated;
  }

  async list(): Promise<SessionSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const summaries: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(this.dir, name), "utf8");
      summaries.push(toSummary(Session.parse(JSON.parse(raw))));
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  async remove(ref: ContentRef): Promise<void> {
    try {
      await fs.unlink(this.file(sessionKey(ref)));
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

/**
 * Non-durable store for tests and a "glances-only" mode (no days-later resume).
 * Returns deep copies so callers can't mutate stored state by reference.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, Session>();

  async load(ref: ContentRef): Promise<Session | null> {
    const found = this.map.get(sessionKey(ref));
    return found ? structuredClone(found) : null;
  }

  async save(session: Session): Promise<Session> {
    assertKeyMatches(session);
    const validated = Session.parse({ ...session, updatedAt: new Date().toISOString() });
    this.map.set(validated.key, validated);
    return structuredClone(validated);
  }

  async list(): Promise<SessionSummary[]> {
    return [...this.map.values()]
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async remove(ref: ContentRef): Promise<void> {
    this.map.delete(sessionKey(ref));
  }
}
