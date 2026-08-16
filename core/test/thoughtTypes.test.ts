import { describe, it, expect } from "vitest";
import {
  Capture,
  Digest,
  DeliveryPolicy,
  DndWindow,
  INTERRUPT_LEVEL_ORDER,
  ResearchJob,
  Thread,
  interruptLevelIndex,
  minInterruptLevel,
  newThread,
  roundDownInterruptLevel,
} from "../src/types";

describe("Thread schema", () => {
  it("defaults turns/jobIds/digestIds to empty and the ceiling to speak", () => {
    const thread = Thread.parse({
      id: "t1",
      topic: "spaced repetition",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(thread.turns).toEqual([]);
    expect(thread.jobIds).toEqual([]);
    expect(thread.digestIds).toEqual([]);
    expect(thread.deliveryCeiling).toBe("speak");
  });

  it("newThread stamps id, topic, and timestamps", () => {
    const thread = newThread("the testing effect");
    expect(thread.id).toBeTruthy();
    expect(thread.topic).toBe("the testing effect");
    expect(thread.createdAt).toBe(thread.updatedAt);
    expect(Thread.parse(thread)).toEqual(thread);
  });

  it("rejects an empty topic", () => {
    expect(() => Thread.parse({ ...newThread("x"), topic: "" })).toThrow();
  });
});

describe("Capture schema", () => {
  it("parses a capture without a thread and has no image field", () => {
    const capture = Capture.parse({
      id: "c1",
      source: "glassesCamera",
      kind: "whiteboard",
      extract: "boxes and arrows",
      ts: new Date().toISOString(),
    });
    expect(capture.threadId).toBeUndefined();
    expect("imageBase64" in capture).toBe(false);
    expect("frame" in capture).toBe(false);
  });

  it("rejects an unknown kind and an unknown source", () => {
    const base = { id: "c1", extract: "x", ts: new Date().toISOString() };
    expect(() => Capture.parse({ ...base, source: "glassesCamera", kind: "selfie" })).toThrow();
    expect(() => Capture.parse({ ...base, source: "webcam", kind: "scene" })).toThrow();
  });
});

describe("Digest schema", () => {
  it("bounds confidence to 0..1 and defaults citations/followups", () => {
    const digest = Digest.parse({ tldr: "Short answer.", body: "Long answer.", confidence: 0.5 });
    expect(digest.citations).toEqual([]);
    expect(digest.followups).toEqual([]);
    expect(() => Digest.parse({ tldr: "x", body: "y", confidence: 1.2 })).toThrow();
    expect(() => Digest.parse({ tldr: "", body: "y", confidence: 0.5 })).toThrow();
  });
});

describe("ResearchJob schema", () => {
  const base = {
    id: "j1",
    threadId: "t1",
    question: "what does the literature say?",
    budget: { maxTokens: 150_000, maxSeconds: 120 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("defaults state to queued, captureIds to [], invited to false", () => {
    const job = ResearchJob.parse(base);
    expect(job.state).toBe("queued");
    expect(job.captureIds).toEqual([]);
    expect(job.invited).toBe(false);
  });

  it("rejects an unknown state and a non-positive budget", () => {
    expect(() => ResearchJob.parse({ ...base, state: "paused" })).toThrow();
    expect(() => ResearchJob.parse({ ...base, budget: { maxTokens: 0, maxSeconds: 10 } })).toThrow();
  });
});

describe("InterruptLevel ladder", () => {
  it("is ordered hold < badge < earcon < speak", () => {
    expect(INTERRUPT_LEVEL_ORDER).toEqual(["hold", "badge", "earcon", "speak"]);
    expect(interruptLevelIndex("hold")).toBeLessThan(interruptLevelIndex("speak"));
  });

  it("minInterruptLevel picks the quieter level", () => {
    expect(minInterruptLevel("speak", "badge")).toBe("badge");
    expect(minInterruptLevel("hold", "earcon")).toBe("hold");
    expect(minInterruptLevel("earcon", "earcon")).toBe("earcon");
  });

  it("roundDownInterruptLevel steps down once and never below hold", () => {
    expect(roundDownInterruptLevel("speak")).toBe("earcon");
    expect(roundDownInterruptLevel("earcon")).toBe("badge");
    expect(roundDownInterruptLevel("badge")).toBe("hold");
    expect(roundDownInterruptLevel("hold")).toBe("hold");
  });
});

describe("DeliveryPolicy schema", () => {
  it("defaults to speak ceiling, no DND windows, suppression on", () => {
    const policy = DeliveryPolicy.parse({});
    expect(policy).toEqual({ ceiling: "speak", dndWindows: [], suppressWhileConversing: true });
  });

  it("validates HH:MM DND windows", () => {
    expect(DndWindow.parse({ start: "22:00", end: "07:00" })).toBeTruthy();
    expect(() => DndWindow.parse({ start: "9:00", end: "17:00" })).toThrow();
    expect(() => DndWindow.parse({ start: "25:00", end: "17:00" })).toThrow();
  });
});
