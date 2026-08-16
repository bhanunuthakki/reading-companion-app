/**
 * Durable persistence for Threads — persistent lines of inquiry, keyed by id
 * (topic-born, not Content-born). One JSON document per Thread under THREAD_DIR
 * (default core/.threads/), exactly the SessionStore pattern: FileThreadStore
 * for the real thing, InMemoryThreadStore for tests. Threads survive across
 * days, devices, and Contents; ResearchJobs are persisted separately in the
 * JobStore and referenced from Thread.jobIds.
 */
import { Thread, type InterruptLevel } from "./types";
import { FileDocStore, MemoryDocStore, type DocStore } from "./docStore";

export interface ThreadSummary {
  id: string;
  topic: string;
  updatedAt: string;
  turnCount: number;
  jobCount: number;
  digestCount: number;
  deliveryCeiling: InterruptLevel;
}

export interface ThreadStore {
  /** The thread with this id, or null if none exists. */
  load(id: string): Promise<Thread | null>;
  /** Persist the thread, stamping updatedAt. Returns the persisted copy. */
  save(thread: Thread): Promise<Thread>;
  /** Summaries of all threads, newest activity first (the phone's thread list). */
  list(): Promise<ThreadSummary[]>;
  /** Full documents of all threads (MemoryIndex seeding). */
  all(): Promise<Thread[]>;
  /** Forget a thread. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

function stampUpdatedAt(thread: Thread): Thread {
  return { ...thread, updatedAt: new Date().toISOString() };
}

function toSummary(thread: Thread): ThreadSummary {
  return {
    id: thread.id,
    topic: thread.topic,
    updatedAt: thread.updatedAt,
    turnCount: thread.turns.length,
    jobCount: thread.jobIds.length,
    digestCount: thread.digestIds.length,
    deliveryCeiling: thread.deliveryCeiling,
  };
}

class DocThreadStore implements ThreadStore {
  constructor(private readonly docs: DocStore<Thread>) {}

  load(id: string): Promise<Thread | null> {
    return this.docs.load(id);
  }

  save(thread: Thread): Promise<Thread> {
    return this.docs.save(thread);
  }

  async list(): Promise<ThreadSummary[]> {
    const summaries = (await this.docs.list()).map(toSummary);
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  all(): Promise<Thread[]> {
    return this.docs.list();
  }

  remove(id: string): Promise<void> {
    return this.docs.remove(id);
  }
}

export class FileThreadStore extends DocThreadStore {
  constructor(dir: string) {
    super(new FileDocStore(dir, Thread, stampUpdatedAt));
  }
}

export class InMemoryThreadStore extends DocThreadStore {
  constructor() {
    super(new MemoryDocStore(Thread, stampUpdatedAt));
  }
}
