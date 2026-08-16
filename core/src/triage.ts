/**
 * Triage — routes an ask (thought-partner-spec.md §3).
 *
 * Fast path: answerable now → the existing ResearchProvider answers and the
 * client speaks it immediately. Background: needs sources, synthesis, or
 * fan-out → a ResearchJob on the WorkQueue ("on it — I'll come back").
 * The TriageDecision always carries the route so the client can announce
 * "quick answer" vs "on it".
 *
 * Provider seam like the research one: HeuristicTriageProvider is the
 * deterministic offline router; GeminiTriageProvider is a cheap structured-
 * output model call when a key exists.
 */
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const TriageRoute = z.enum(["fast", "background"]);
export type TriageRoute = z.infer<typeof TriageRoute>;

export const TriageDecision = z.object({
  route: TriageRoute,
  reason: z.string(),
});
export type TriageDecision = z.infer<typeof TriageDecision>;

export interface TriageInput {
  question: string;
  /** The extract of an attached Capture, if the ask referenced one. */
  captureExtract?: string;
}

export interface TriageProvider {
  triage(input: TriageInput): Promise<TriageDecision>;
}

/**
 * The documented offline heuristic, in order:
 *   1. The question mentions a research marker (substring, case-insensitive)
 *      → background. Markers: literature, research, evidence, compare,
 *      sources, find papers, studies, survey, meta-analysis.
 *   2. The question is longer than 140 characters → background (long asks
 *      want synthesis, not a one-liner).
 *   3. Otherwise (short/definitional) → fast.
 */
export const BACKGROUND_MARKERS: readonly string[] = [
  "literature",
  "research",
  "evidence",
  "compare",
  "sources",
  "find papers",
  "studies",
  "survey",
  "meta-analysis",
];

export const BACKGROUND_LENGTH_THRESHOLD = 140;

export class HeuristicTriageProvider implements TriageProvider {
  async triage(input: TriageInput): Promise<TriageDecision> {
    const question = input.question.toLowerCase();
    const marker = BACKGROUND_MARKERS.find((m) => question.includes(m));
    if (marker) {
      return { route: "background", reason: `question mentions "${marker}"` };
    }
    if (input.question.length > BACKGROUND_LENGTH_THRESHOLD) {
      return {
        route: "background",
        reason: `question longer than ${BACKGROUND_LENGTH_THRESHOLD} characters`,
      };
    }
    return { route: "fast", reason: "short question with no research markers" };
  }
}

const TRIAGE_SYSTEM = `You route questions for a background thought partner.
Route "fast" when the question is answerable immediately from general knowledge or the provided context (definitions, quick facts, who/what is this).
Route "background" when it needs sources, literature, synthesis, comparison, or fan-out research.
Respond with ONLY a JSON object: { "route": "fast" | "background", "reason": "<one short sentence>" }`;

export class GeminiTriageProvider implements TriageProvider {
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async triage(input: TriageInput): Promise<TriageDecision> {
    const parts: string[] = [];
    if (input.captureExtract) parts.push(`Captured context:\n${input.captureExtract}`);
    parts.push(`Question: ${input.question}`);
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: parts.join("\n\n") }] }],
      config: { systemInstruction: TRIAGE_SYSTEM, responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Triage returned an empty response.");
    return TriageDecision.parse(JSON.parse(text));
  }
}
