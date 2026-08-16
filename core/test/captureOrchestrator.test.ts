import { describe, it, expect } from "vitest";
import { CaptureOrchestrator } from "../src/imagePipeline/captureOrchestrator";

describe("CaptureOrchestrator escalation ladder", () => {
  it("starts idle with video off", () => {
    const orch = new CaptureOrchestrator();
    expect(orch.currentLevel).toBe("idle");
  });

  it("wakes to alerted and grabs a still on first voice activity", () => {
    const orch = new CaptureOrchestrator();
    const effect = orch.onTrigger("voice", 0);
    expect(effect).toMatchObject({ level: "alerted", captureStill: true, videoFps: 0 });
  });

  it("captures a fresh still on a page-turn cue", () => {
    const orch = new CaptureOrchestrator();
    orch.onTrigger("voice", 0); // already alerted
    expect(orch.onTrigger("rustle", 100)).toMatchObject({ captureStill: true });
  });

  it("escalates to active with video on an explicit query", () => {
    const orch = new CaptureOrchestrator();
    const effect = orch.onTrigger("query", 0);
    expect(effect.level).toBe("active");
    expect(effect.videoFps).toBeGreaterThan(0);
  });

  it("decays active → alerted after sustained silence", () => {
    const orch = new CaptureOrchestrator({ silenceToAlertedMs: 30_000 });
    orch.onTrigger("query", 0);
    const effect = orch.tick(31_000);
    expect(effect).toMatchObject({ level: "alerted", videoFps: 0 });
  });

  it("decays all the way to idle after long inactivity", () => {
    const orch = new CaptureOrchestrator({ inactivityToIdleMs: 300_000 });
    orch.onTrigger("query", 0);
    expect(orch.tick(301_000).level).toBe("idle");
  });
});
