import { describe, it, expect } from "vitest";
import { BADGE_EXPIRY_MS, DeliveryEngine, isInDndWindow, type DeliveryInput } from "../src/deliveryEngine";
import { DeliveryPolicy } from "../src/types";

const openPolicy = DeliveryPolicy.parse({}); // speak ceiling, no DND, suppression on

function input(overrides: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    event: "job_completion",
    policy: openPolicy,
    worn: true,
    deviceHasDisplay: true,
    ...overrides,
  };
}

const engine = new DeliveryEngine();

describe("DeliveryEngine — etiquette rules (spec §7)", () => {
  it("rule 1: conversation in the last 15 s caps the level at earcon", () => {
    const decision = engine.decide(input({ invited: true, conversationDetected: true }));
    expect(decision).toEqual({ level: "earcon", surface: "glasses" });
  });

  it("rule 1 is governed by the policy's conversation-suppression flag", () => {
    const policy = DeliveryPolicy.parse({ suppressWhileConversing: false });
    const decision = engine.decide(input({ policy, invited: true, conversationDetected: true }));
    expect(decision.level).toBe("speak");
  });

  it("rule 2: glasses not worn → surface phone, level hold — no matter what", () => {
    const decision = engine.decide(input({ worn: false, invited: true }));
    expect(decision).toEqual({ level: "hold", surface: "phone" });
  });

  it("rule 3: default levels — completion badge (display) / earcon (audio-only), watcher badge, fast answer speak", () => {
    expect(engine.decide(input()).level).toBe("badge");
    expect(engine.decide(input({ deviceHasDisplay: false })).level).toBe("earcon");
    expect(engine.decide(input({ event: "watcher_fire" })).level).toBe("badge");
    expect(engine.decide(input({ event: "watcher_fire", deviceHasDisplay: false })).level).toBe("badge");
    expect(engine.decide(input({ event: "fast_answer" })).level).toBe("speak");
  });

  it("rule 4: a 'tell me when you're back' invitation upgrades that job to speak", () => {
    expect(engine.decide(input({ invited: true })).level).toBe("speak");
    // …but only job completions; a watcher fire is not invited.
    expect(engine.decide(input({ event: "watcher_fire", invited: true })).level).toBe("badge");
  });

  it("rule 5: uncertainty rounds down exactly one level, never up", () => {
    expect(engine.decide(input({ invited: true, uncertain: true })).level).toBe("earcon");
    expect(engine.decide(input({ uncertain: true }))).toEqual({ level: "hold", surface: "phone" });
    const held = engine.decide(input({ uncertain: true, policy: DeliveryPolicy.parse({ ceiling: "hold" }) }));
    expect(held.level).toBe("hold"); // hold stays hold
  });

  it("rule 5: a DND window rounds down one level (including across midnight)", () => {
    const policy = DeliveryPolicy.parse({ dndWindows: [{ start: "22:00", end: "07:00" }] });
    const at = (iso: string) => engine.decide(input({ policy, invited: true, now: new Date(iso) }));
    expect(at("2026-07-07T23:30:00").level).toBe("earcon"); // inside, before midnight
    expect(at("2026-07-07T06:15:00").level).toBe("earcon"); // inside, after midnight
    expect(at("2026-07-07T12:00:00").level).toBe("speak"); // outside
  });

  it("rule 7: the per-thread ceiling clamps everything, even invitations", () => {
    expect(engine.decide(input({ invited: true, policy: DeliveryPolicy.parse({ ceiling: "badge" }) })).level).toBe(
      "badge",
    );
    expect(engine.decide(input({ invited: true, policy: DeliveryPolicy.parse({ ceiling: "hold" }) }))).toEqual({
      level: "hold",
      surface: "phone",
    });
  });

  it("routes hold to the phone and everything louder to the glasses", () => {
    expect(engine.decide(input()).surface).toBe("glasses");
    expect(engine.decide(input({ policy: DeliveryPolicy.parse({ ceiling: "hold" }) })).surface).toBe("phone");
  });
});

describe("DeliveryEngine — rule 6 badge expiry (clock-abstracted)", () => {
  it("expires unacknowledged badges to the phone after 10 minutes", () => {
    let now = 1_000_000;
    const clocked = new DeliveryEngine({ now: () => now });
    clocked.trackBadge("job-a");
    clocked.trackBadge("job-b");

    now += BADGE_EXPIRY_MS - 1;
    expect(clocked.expireBadges()).toEqual([]); // not yet

    now += 2;
    const expired = clocked.expireBadges();
    expect(expired.map((e) => e.jobId).sort()).toEqual(["job-a", "job-b"]);
    expect(expired[0]?.decision).toEqual({ level: "hold", surface: "phone" });
    expect(clocked.expireBadges()).toEqual([]); // expired badges stop being tracked
  });

  it("an acknowledged badge never expires", () => {
    let now = 0;
    const clocked = new DeliveryEngine({ now: () => now });
    clocked.trackBadge("job-a");
    clocked.acknowledgeBadge("job-a");
    now += BADGE_EXPIRY_MS * 2;
    expect(clocked.expireBadges()).toEqual([]);
  });
});

describe("isInDndWindow", () => {
  it("handles same-day and midnight-spanning windows", () => {
    const day = [{ start: "09:00", end: "17:00" }];
    expect(isInDndWindow(new Date("2026-07-07T10:00:00"), day)).toBe(true);
    expect(isInDndWindow(new Date("2026-07-07T08:59:00"), day)).toBe(false);
    const night = [{ start: "22:00", end: "07:00" }];
    expect(isInDndWindow(new Date("2026-07-07T22:00:00"), night)).toBe(true);
    expect(isInDndWindow(new Date("2026-07-07T07:00:00"), night)).toBe(false);
  });
});
