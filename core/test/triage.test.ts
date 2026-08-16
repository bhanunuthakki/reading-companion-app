import { describe, it, expect } from "vitest";
import { BACKGROUND_LENGTH_THRESHOLD, HeuristicTriageProvider } from "../src/triage";

const triage = new HeuristicTriageProvider();

describe("HeuristicTriageProvider", () => {
  it("routes short definitional questions to the fast path", async () => {
    const decision = await triage.triage({ question: "what does 'inchoate' mean?" });
    expect(decision.route).toBe("fast");
    expect(decision.reason).toBeTruthy();
  });

  it("routes research-marker questions to the background path", async () => {
    for (const question of [
      "what does the literature say about spaced repetition?",
      "find papers comparing retrieval practice and rereading",
      "is there good evidence for the testing effect?",
      "compare Kahneman's and Gigerenzer's takes on heuristics",
    ]) {
      const decision = await triage.triage({ question });
      expect(decision.route, question).toBe("background");
    }
  });

  it("routes very long questions to the background path", async () => {
    const question = `why exactly did the author claim ${"very ".repeat(30)}strong things here?`;
    expect(question.length).toBeGreaterThan(BACKGROUND_LENGTH_THRESHOLD);
    const decision = await triage.triage({ question });
    expect(decision.route).toBe("background");
    expect(decision.reason).toContain(String(BACKGROUND_LENGTH_THRESHOLD));
  });

  it("is deterministic and states its reason", async () => {
    const a = await triage.triage({ question: "define anchoring" });
    const b = await triage.triage({ question: "define anchoring" });
    expect(a).toEqual(b);
    expect(a.reason.length).toBeGreaterThan(0);
  });

  it("accepts an optional capture extract without changing the contract", async () => {
    const decision = await triage.triage({
      question: "what is this diagram about?",
      captureExtract: "boxes labeled encoder and decoder",
    });
    expect(["fast", "background"]).toContain(decision.route);
  });
});
