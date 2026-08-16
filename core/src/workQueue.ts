/**
 * WorkQueue — the Core's background job scheduler (thought-partner-spec.md §5/§6).
 *
 * Owns the entire ResearchJob lifecycle:
 *   queued → running → digest_ready → delivered → archived, or → failed
 * with a concurrency cap (v1 default: 2), per-job budget enforcement
 * (budget.maxSeconds races the provider call → "failed" with a reason;
 * budget.maxTokens is the cap the recorded tokensUsed is judged against),
 * cancellation, and restart recovery.
 *
 * Every state transition (a) persists the job in the JobStore — one JSON
 * document per job under JOB_DIR, see jobStore.ts — and then (b) emits a typed
 * JobTransition event, which SessionConnection forwards over WS as job_update.
 *
 * The research work itself runs through the DigestResearchProvider seam
 * (research/dispatcher.ts): mock offline, Gemini grounded search with a key.
 */
import { randomUUID } from "node:crypto";
import { ResearchJob, type JobBudget, type JobState } from "./types";
import type { JobStore } from "./jobStore";
import type { DigestResearchProvider } from "./research/dispatcher";
import { redactSecrets } from "./redact";

/** Spec §11: default job budget — 150k tokens, two minutes of wall clock. */
export const DEFAULT_JOB_BUDGET: JobBudget = { maxTokens: 150_000, maxSeconds: 120 };

const LEGAL_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ["running", "archived"],
  running: ["digest_ready", "failed", "archived"],
  digest_ready: ["delivered", "archived"],
  delivered: ["archived"],
  failed: ["archived"],
  archived: [],
};

export interface JobTransition {
  /** A snapshot of the job after the transition persisted. */
  job: ResearchJob;
  /** The previous state, or null when the job was just created (queued). */
  from: JobState | null;
}

export type JobTransitionHandler = (transition: JobTransition) => void;

export interface WorkQueueDeps {
  jobs: JobStore;
  provider: DigestResearchProvider;
  /** Max jobs running at once. Default 2 (spec §5 WorkQueue). */
  concurrency?: number;
}

export interface SubmitInput {
  threadId: string;
  question: string;
  captureIds?: string[];
  /** The capture extracts handed to the provider (not persisted on the job — the ids are). */
  captureExtracts?: string[];
  threadTopic?: string;
  budget?: Partial<JobBudget>;
  invited?: boolean;
}

class BudgetExceededError extends Error {}

export class WorkQueue {
  private readonly concurrency: number;
  private readonly queue: string[] = [];
  private readonly jobsById = new Map<string, ResearchJob>();
  private readonly workInputs = new Map<string, { captureExtracts: string[]; threadTopic?: string }>();
  private readonly handlers = new Set<JobTransitionHandler>();
  private readonly idleResolvers: Array<() => void> = [];
  private runningCount = 0;

  constructor(private readonly deps: WorkQueueDeps) {
    this.concurrency = deps.concurrency ?? 2;
    if (this.concurrency < 1) throw new Error("WorkQueue concurrency must be at least 1.");
  }

  /** Subscribe to job transitions. Returns an unsubscribe function. */
  onTransition(handler: JobTransitionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Create, persist, and schedule a new ResearchJob (state "queued"). */
  async submit(input: SubmitInput): Promise<ResearchJob> {
    const now = new Date().toISOString();
    const job = ResearchJob.parse({
      id: randomUUID(),
      threadId: input.threadId,
      question: input.question,
      captureIds: input.captureIds ?? [],
      state: "queued",
      budget: { ...DEFAULT_JOB_BUDGET, ...input.budget },
      createdAt: now,
      updatedAt: now,
      invited: input.invited ?? false,
    });
    this.workInputs.set(job.id, {
      captureExtracts: input.captureExtracts ?? [],
      ...(input.threadTopic ? { threadTopic: input.threadTopic } : {}),
    });
    const persisted = await this.deps.jobs.save(job);
    this.jobsById.set(persisted.id, persisted);
    this.emit({ job: structuredClone(persisted), from: null });
    this.queue.push(persisted.id);
    this.pump();
    return structuredClone(persisted);
  }

  /**
   * Cancel a queued or running job → "archived". Cancellation of a running job
   * is cooperative: the in-flight provider call is not aborted, but its result
   * is discarded and the concurrency slot frees when it settles or times out.
   */
  async cancel(jobId: string): Promise<ResearchJob> {
    const job = this.require(jobId);
    if (job.state !== "queued" && job.state !== "running") {
      throw new Error(`Cannot cancel job ${jobId} in state "${job.state}".`);
    }
    if (job.state === "queued") {
      const idx = this.queue.indexOf(jobId);
      if (idx !== -1) this.queue.splice(idx, 1);
    }
    const archived = await this.transition(job, "archived");
    this.maybeIdle();
    return archived;
  }

  /** The digest reached the user (DeliveryEngine level above hold). */
  async markDelivered(jobId: string): Promise<ResearchJob> {
    return this.transition(this.require(jobId), "delivered");
  }

  /** User dismissed the job/digest on the phone. */
  async archive(jobId: string): Promise<ResearchJob> {
    return this.transition(this.require(jobId), "archived");
  }

  /** Snapshot of a tracked job, or null. */
  get(jobId: string): ResearchJob | null {
    const job = this.jobsById.get(jobId);
    return job ? structuredClone(job) : null;
  }

  /**
   * Reload persisted jobs after a Core restart: queued jobs re-enter the queue;
   * jobs caught "running" fail loudly — the in-flight work is gone and we never
   * pretend otherwise.
   */
  async recover(): Promise<void> {
    for (const job of await this.deps.jobs.list()) {
      if (this.jobsById.has(job.id)) continue;
      this.jobsById.set(job.id, job);
      if (job.state === "queued") {
        this.workInputs.set(job.id, { captureExtracts: [] });
        this.queue.push(job.id);
      } else if (job.state === "running") {
        job.failure = "interrupted by Core restart before completion";
        await this.transition(job, "failed");
      }
    }
    this.pump();
  }

  /** Resolves once no job is queued or running (tests, drain-before-shutdown). */
  whenIdle(): Promise<void> {
    if (this.runningCount === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private pump(): void {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (id === undefined) break;
      const job = this.jobsById.get(id);
      if (!job || job.state !== "queued") continue; // cancelled while waiting
      this.runningCount++;
      void this.run(job.id).finally(() => {
        this.runningCount--;
        this.pump();
      });
    }
    this.maybeIdle();
  }

  private async run(jobId: string): Promise<void> {
    let job = this.require(jobId);
    job = await this.transition(job, "running");

    const work = this.workInputs.get(jobId) ?? { captureExtracts: [] };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BudgetExceededError(`budget exceeded: ran longer than ${job.budget.maxSeconds}s`)),
        job.budget.maxSeconds * 1000,
      );
    });

    try {
      const result = await Promise.race([
        this.deps.provider.researchDigest({
          question: job.question,
          captureExtracts: work.captureExtracts,
          ...(work.threadTopic ? { threadTopic: work.threadTopic } : {}),
        }),
        timeout,
      ]);
      const current = this.jobsById.get(jobId);
      if (!current || current.state !== "running") return; // cancelled mid-flight; discard the result
      current.digest = result.digest;
      current.tokensUsed = result.tokensUsed;
      await this.transition(current, "digest_ready");
    } catch (err) {
      const current = this.jobsById.get(jobId);
      if (!current || current.state !== "running") return; // cancelled mid-flight
      current.failure = redactSecrets(err instanceof Error ? err.message : String(err));
      await this.transition(current, "failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.workInputs.delete(jobId);
    }
  }

  /** Validate the state machine, persist, then emit — in that order, always. */
  private async transition(job: ResearchJob, to: JobState): Promise<ResearchJob> {
    const from = job.state;
    if (!LEGAL_TRANSITIONS[from].includes(to)) {
      throw new Error(`Illegal ResearchJob transition "${from}" → "${to}" (job ${job.id}).`);
    }
    job.state = to;
    job.updatedAt = new Date().toISOString();
    const persisted = await this.deps.jobs.save(job);
    this.jobsById.set(persisted.id, persisted);
    this.emit({ job: structuredClone(persisted), from });
    return persisted;
  }

  private emit(transition: JobTransition): void {
    for (const handler of this.handlers) handler(transition);
  }

  private require(jobId: string): ResearchJob {
    const job = this.jobsById.get(jobId);
    if (!job) throw new Error(`No job with id ${jobId}.`);
    return job;
  }

  private maybeIdle(): void {
    if (this.runningCount === 0 && this.queue.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve();
    }
  }
}
