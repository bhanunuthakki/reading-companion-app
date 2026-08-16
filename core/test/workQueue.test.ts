import { describe, it, expect } from "vitest";
import { InMemoryJobStore } from "../src/jobStore";
import { WorkQueue, type JobTransition } from "../src/workQueue";
import { MockResearchProvider, type DigestResearchProvider, type DigestResearchResult } from "../src/research/dispatcher";
import type { JobState } from "../src/types";

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A provider whose calls only complete when the test says so. */
function deferredProvider(): {
  provider: DigestResearchProvider;
  calls: number;
  peak: number;
  active: number;
  resolveNext: () => void;
  api: { readonly calls: number; readonly peak: number; readonly active: number };
} {
  const mock = new MockResearchProvider();
  const pending: Array<(result: DigestResearchResult) => void> = [];
  const state = { calls: 0, peak: 0, active: 0 };
  const provider: DigestResearchProvider = {
    researchDigest: (input) =>
      new Promise((resolve) => {
        state.calls++;
        state.active++;
        state.peak = Math.max(state.peak, state.active);
        pending.push((result) => {
          state.active--;
          resolve(result);
        });
        void input;
      }),
  };
  return {
    provider,
    get calls() {
      return state.calls;
    },
    get peak() {
      return state.peak;
    },
    get active() {
      return state.active;
    },
    resolveNext: () => {
      const next = pending.shift();
      if (!next) throw new Error("no pending provider call");
      void mock.researchDigest({ question: "x" }).then(next);
    },
    api: state,
  };
}

const submitInput = (n: number) => ({ threadId: "thread-1", question: `background question ${n} on the literature` });

describe("WorkQueue", () => {
  it("runs the full transition sequence, persisting and emitting every step", async () => {
    const jobs = new InMemoryJobStore();
    const queue = new WorkQueue({ jobs, provider: new MockResearchProvider() });
    const transitions: Array<{ from: JobState | null; to: JobState }> = [];
    queue.onTransition((t: JobTransition) => transitions.push({ from: t.from, to: t.job.state }));

    const job = await queue.submit(submitInput(1));
    await queue.whenIdle();
    await queue.markDelivered(job.id);
    await queue.archive(job.id);

    expect(transitions).toEqual([
      { from: null, to: "queued" },
      { from: "queued", to: "running" },
      { from: "running", to: "digest_ready" },
      { from: "digest_ready", to: "delivered" },
      { from: "delivered", to: "archived" },
    ]);
    expect((await jobs.load(job.id))?.state).toBe("archived");
  });

  it("persists the digest and the provider-reported tokensUsed at digest_ready", async () => {
    const jobs = new InMemoryJobStore();
    const queue = new WorkQueue({ jobs, provider: new MockResearchProvider() });
    const job = await queue.submit(submitInput(2));
    await queue.whenIdle();

    const persisted = await jobs.load(job.id);
    expect(persisted?.state).toBe("digest_ready");
    expect(persisted?.digest?.tldr).toContain("Mock digest");
    expect(persisted?.digest?.citations.length).toBeGreaterThanOrEqual(2);
    expect(persisted?.tokensUsed).toBe(1234);
  });

  it("honors the concurrency cap (default 2)", async () => {
    const deferred = deferredProvider();
    const queue = new WorkQueue({ jobs: new InMemoryJobStore(), provider: deferred.provider });
    await queue.submit(submitInput(1));
    await queue.submit(submitInput(2));
    await queue.submit(submitInput(3));

    await waitFor(() => deferred.calls === 2);
    // Third job must wait: never more than two in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deferred.calls).toBe(2);
    expect(deferred.peak).toBe(2);

    deferred.resolveNext();
    await waitFor(() => deferred.calls === 3);
    deferred.resolveNext();
    deferred.resolveNext();
    await queue.whenIdle();
    expect(deferred.peak).toBe(2);
  });

  it("fails a job that exceeds budget.maxSeconds, with a reason", async () => {
    const never: DigestResearchProvider = { researchDigest: () => new Promise(() => {}) };
    const jobs = new InMemoryJobStore();
    const queue = new WorkQueue({ jobs, provider: never });
    const job = await queue.submit({ ...submitInput(4), budget: { maxSeconds: 0.05 } });
    await queue.whenIdle();

    const persisted = await jobs.load(job.id);
    expect(persisted?.state).toBe("failed");
    expect(persisted?.failure).toContain("budget exceeded");
  });

  it("cancels a queued job without ever running it", async () => {
    const deferred = deferredProvider();
    const jobs = new InMemoryJobStore();
    const queue = new WorkQueue({ jobs, provider: deferred.provider, concurrency: 1 });
    await queue.submit(submitInput(1));
    const waiting = await queue.submit(submitInput(2));

    const cancelled = await queue.cancel(waiting.id);
    expect(cancelled.state).toBe("archived");
    deferred.resolveNext();
    await queue.whenIdle();
    expect(deferred.calls).toBe(1); // the cancelled job never reached the provider
    expect((await jobs.load(waiting.id))?.state).toBe("archived");
  });

  it("cancels a running job and discards its late result", async () => {
    const deferred = deferredProvider();
    const jobs = new InMemoryJobStore();
    const queue = new WorkQueue({ jobs, provider: deferred.provider });
    const job = await queue.submit(submitInput(5));
    await waitFor(() => deferred.calls === 1);

    await queue.cancel(job.id);
    deferred.resolveNext(); // the in-flight result arrives after cancellation…
    await queue.whenIdle();
    const persisted = await jobs.load(job.id);
    expect(persisted?.state).toBe("archived"); // …and is discarded
    expect(persisted?.digest).toBeUndefined();
  });

  it("rejects illegal transitions loudly", async () => {
    const deferred = deferredProvider();
    const queue = new WorkQueue({ jobs: new InMemoryJobStore(), provider: deferred.provider });
    const job = await queue.submit(submitInput(6));
    await expect(queue.markDelivered(job.id)).rejects.toThrow(/Illegal ResearchJob transition/);
    deferred.resolveNext();
    await queue.whenIdle();
  });

  it("recover(): re-queues queued jobs and fails jobs caught running", async () => {
    const jobs = new InMemoryJobStore();
    const now = new Date().toISOString();
    await jobs.save({
      id: "stale-running",
      threadId: "t",
      question: "was mid-flight at crash",
      captureIds: [],
      state: "running",
      budget: { maxTokens: 1000, maxSeconds: 60 },
      createdAt: now,
      updatedAt: now,
      invited: false,
    });
    await jobs.save({
      id: "stale-queued",
      threadId: "t",
      question: "never started",
      captureIds: [],
      state: "queued",
      budget: { maxTokens: 1000, maxSeconds: 60 },
      createdAt: now,
      updatedAt: now,
      invited: false,
    });

    const queue = new WorkQueue({ jobs, provider: new MockResearchProvider() });
    await queue.recover();
    await queue.whenIdle();

    const failed = await jobs.load("stale-running");
    expect(failed?.state).toBe("failed");
    expect(failed?.failure).toContain("restart");
    expect((await jobs.load("stale-queued"))?.state).toBe("digest_ready");
  });
});
