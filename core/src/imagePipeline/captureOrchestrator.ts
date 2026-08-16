/**
 * The escalation ladder from staged-roadmap.md, as a deterministic state
 * machine. It decides how much the camera works — the single biggest battery
 * sink on BLE-tethered glasses — by climbing on activity and decaying on
 * silence:
 *
 *   IDLE     mic only, video off
 *     │ voice / paper-rustle / book-raise  → single still → OCR
 *   ALERTED  one still on trigger, video off
 *     │ explicit query / model interjection
 *   ACTIVE   audio out + low-fps video for visual cue tracking
 *     │ 30 s silence → ALERTED ; 5 min idle → IDLE
 *
 * `nowMs` is passed in so decay is testable without real clocks.
 */
import type { EscalationLevel } from "../types";

export type TriggerKind = "voice" | "rustle" | "imu" | "query" | "interject";

export interface CaptureEffect {
  level: EscalationLevel;
  /** Capture a single still now (feeds OCR). */
  captureStill: boolean;
  /** Continuous video duty in frames/sec (0 = video off). */
  videoFps: number;
}

export interface CaptureConfig {
  /** ACTIVE decays to ALERTED after this much silence. */
  silenceToAlertedMs: number;
  /** ALERTED decays to IDLE after this much total inactivity. */
  inactivityToIdleMs: number;
  /** Video duty while ACTIVE. */
  activeVideoFps: number;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  silenceToAlertedMs: 30_000,
  inactivityToIdleMs: 300_000,
  activeVideoFps: 1,
};

const NEW_PAGE_TRIGGERS: ReadonlySet<TriggerKind> = new Set<TriggerKind>(["rustle", "imu"]);
const ACTIVATING_TRIGGERS: ReadonlySet<TriggerKind> = new Set<TriggerKind>(["query", "interject"]);

export class CaptureOrchestrator {
  private level: EscalationLevel = "idle";
  private lastActivityAt = Number.NEGATIVE_INFINITY;
  private readonly config: CaptureConfig;

  constructor(config: Partial<CaptureConfig> = {}) {
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
  }

  get currentLevel(): EscalationLevel {
    return this.level;
  }

  /** A sensor or user signal arrived. */
  onTrigger(kind: TriggerKind, nowMs: number): CaptureEffect {
    this.lastActivityAt = nowMs;

    if (ACTIVATING_TRIGGERS.has(kind)) {
      this.level = "active";
      return this.effect(true);
    }

    // voice / rustle / imu: at minimum we wake to ALERTED.
    const wasIdle = this.level === "idle";
    if (wasIdle) this.level = "alerted";

    // A page-turn cue (or first wake) warrants a fresh still for OCR.
    const captureStill = wasIdle || NEW_PAGE_TRIGGERS.has(kind);
    return this.effect(captureStill);
  }

  /** Advance time; apply silence/inactivity decay. */
  tick(nowMs: number): CaptureEffect {
    const idleFor = nowMs - this.lastActivityAt;
    if (idleFor >= this.config.inactivityToIdleMs) {
      this.level = "idle";
    } else if (this.level === "active" && idleFor >= this.config.silenceToAlertedMs) {
      this.level = "alerted";
    }
    return this.effect(false);
  }

  private effect(captureStill: boolean): CaptureEffect {
    return {
      level: this.level,
      captureStill,
      videoFps: this.level === "active" ? this.config.activeVideoFps : 0,
    };
  }
}
