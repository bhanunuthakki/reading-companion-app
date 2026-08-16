/**
 * DeliveryEngine — the etiquette ladder (thought-partner-spec.md §7).
 *
 * The partner's worth is decided less by what it finds than by how it comes
 * back. decide() is pure policy logic implementing the seven rules in priority
 * order; the badge-expiry tracker (rule 6) is the only stateful part and takes
 * an injectable clock so tests never sleep.
 *
 * Rules, in spec priority order:
 *   1. Never speak over people — conversation in the last 15 s caps at earcon.
 *   2. Never deliver to glasses that aren't worn — no wear signal → phone, hold.
 *   3. Defaults: job completion → badge (display) / earcon (audio-only);
 *      watcher fire → badge; fast Answer → speak.
 *   4. "Tell me when you're back" upgrades that job to speak.
 *   5. Round down one level under uncertainty or inside a DND window; never up.
 *   6. A badge not acknowledged within 10 min expires to the phone.
 *   7. The per-thread ceiling clamps everything.
 */
import {
  minInterruptLevel,
  roundDownInterruptLevel,
  type DeliveryPolicy,
  type DndWindow,
  type InterruptLevel,
} from "./types";

export type DeliveryEventKind = "job_completion" | "watcher_fire" | "fast_answer";
export type DeliverySurface = "glasses" | "phone";

export interface DeliveryInput {
  event: DeliveryEventKind;
  policy: DeliveryPolicy;
  /** Wear state from the client's `wear` messages. No signal ever received = false. */
  worn: boolean;
  /** Display device (Meta RBD, XR display glasses) vs audio-only (Gen 1/2 RBM, fall-2026 audio glasses). */
  deviceHasDisplay: boolean;
  /** Rule 4: the user invited this job to speak at dispatch time. */
  invited?: boolean;
  /** Rule 1: VAD detected human conversation in the last 15 s. */
  conversationDetected?: boolean;
  /** Rule 5: any doubt — e.g. low digest confidence. */
  uncertain?: boolean;
  /** Wall clock for the DND check; defaults to now. */
  now?: Date;
}

export interface DeliveryDecision {
  level: InterruptLevel;
  surface: DeliverySurface;
}

export interface ExpiredBadge {
  jobId: string;
  /** Where the expired item goes: it waits in its Thread on the phone. */
  decision: DeliveryDecision;
}

export const BADGE_EXPIRY_MS = 10 * 60 * 1000;
export const CONVERSATION_WINDOW_MS = 15_000;

function minutesOfDay(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** True when `now` falls inside any window. A window with start > end spans midnight. */
export function isInDndWindow(now: Date, windows: DndWindow[]): boolean {
  const minute = now.getHours() * 60 + now.getMinutes();
  return windows.some((w) => {
    const start = minutesOfDay(w.start);
    const end = minutesOfDay(w.end);
    return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  });
}

export interface DeliveryEngineOptions {
  /** Injectable clock (ms since epoch) for badge expiry. Defaults to Date.now. */
  now?: () => number;
  /** Rule 6 timeout. Defaults to BADGE_EXPIRY_MS (10 min). */
  badgeTimeoutMs?: number;
}

export class DeliveryEngine {
  private readonly clock: () => number;
  private readonly badgeTimeoutMs: number;
  /** jobId → epoch ms the badge was shown (rule 6). */
  private readonly badges = new Map<string, number>();

  constructor(options: DeliveryEngineOptions = {}) {
    this.clock = options.now ?? Date.now;
    this.badgeTimeoutMs = options.badgeTimeoutMs ?? BADGE_EXPIRY_MS;
  }

  /** Apply the etiquette rules to one event. Pure — no state is touched. */
  decide(input: DeliveryInput): DeliveryDecision {
    // Rule 2: never deliver to glasses that aren't worn. Overrides everything.
    if (!input.worn) return { level: "hold", surface: "phone" };

    // Rule 3: default levels by event.
    let level: InterruptLevel =
      input.event === "fast_answer"
        ? "speak"
        : input.event === "watcher_fire"
          ? "badge"
          : input.deviceHasDisplay
            ? "badge"
            : "earcon";

    // Rule 4: a spoken invitation upgrades this job's completion to speak.
    if (input.event === "job_completion" && input.invited) level = "speak";

    // Rule 7: the per-thread ceiling clamps everything.
    level = minInterruptLevel(level, input.policy.ceiling);

    // Rule 1: never speak over people.
    if (input.policy.suppressWhileConversing && input.conversationDetected) {
      level = minInterruptLevel(level, "earcon");
    }

    // Rule 5: round down one level under uncertainty or inside a DND window — never up.
    if (input.uncertain || isInDndWindow(input.now ?? new Date(), input.policy.dndWindows)) {
      level = roundDownInterruptLevel(level);
    }

    return { level, surface: level === "hold" ? "phone" : "glasses" };
  }

  /** Rule 6: start the acknowledgment clock for a badge that was just shown. */
  trackBadge(jobId: string): void {
    this.badges.set(jobId, this.clock());
  }

  /** The user glanced at (or opened) the badge; stop tracking it. */
  acknowledgeBadge(jobId: string): void {
    this.badges.delete(jobId);
  }

  /**
   * Rule 6: badges older than the timeout are dismissed on-glasses and expire
   * to the phone. Returns them; each expired badge stops being tracked.
   */
  expireBadges(): ExpiredBadge[] {
    const cutoff = this.clock() - this.badgeTimeoutMs;
    const expired: ExpiredBadge[] = [];
    for (const [jobId, shownAt] of this.badges) {
      if (shownAt <= cutoff) {
        this.badges.delete(jobId);
        expired.push({ jobId, decision: { level: "hold", surface: "phone" } });
      }
    }
    return expired;
  }
}
