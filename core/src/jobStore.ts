/**
 * Durable persistence for ResearchJobs. One JSON document per job under
 * JOB_DIR (default core/.jobs/) — jobs live in their OWN store, not inside the
 * Thread document, because the WorkQueue rewrites a job on every state
 * transition and must not race the connection's Thread writes. A Thread
 * references its jobs by id (Thread.jobIds / Thread.digestIds).
 *
 * The WorkQueue is the single writer: it stamps updatedAt itself at each
 * transition, so this store persists documents verbatim.
 */
import { ResearchJob } from "./types";
import { FileDocStore, MemoryDocStore, type DocStore } from "./docStore";

export interface JobStore {
  /** The job with this id, or null if none exists. */
  load(id: string): Promise<ResearchJob | null>;
  /** Validate + persist the job verbatim. Returns the persisted copy. */
  save(job: ResearchJob): Promise<ResearchJob>;
  /** Every job, newest first (the phone's job queue view + WorkQueue.recover). */
  list(): Promise<ResearchJob[]>;
  /** Forget a job. No-op if it does not exist. */
  remove(id: string): Promise<void>;
}

class DocJobStore implements JobStore {
  constructor(private readonly docs: DocStore<ResearchJob>) {}

  load(id: string): Promise<ResearchJob | null> {
    return this.docs.load(id);
  }

  save(job: ResearchJob): Promise<ResearchJob> {
    return this.docs.save(job);
  }

  async list(): Promise<ResearchJob[]> {
    const jobs = await this.docs.list();
    jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return jobs;
  }

  remove(id: string): Promise<void> {
    return this.docs.remove(id);
  }
}

export class FileJobStore extends DocJobStore {
  constructor(dir: string) {
    super(new FileDocStore(dir, ResearchJob));
  }
}

export class InMemoryJobStore extends DocJobStore {
  constructor() {
    super(new MemoryDocStore(ResearchJob));
  }
}
