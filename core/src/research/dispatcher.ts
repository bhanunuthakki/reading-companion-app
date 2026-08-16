/**
 * ResearchProvider — the heavy-lift "pull the literature" step.
 *
 * Two halves of the same seam:
 *   - research()        the synchronous fast path: question in, spoken Answer out.
 *   - researchDigest()  a ResearchJob's WORK step: question + capture extracts in,
 *                       Digest (tldr + body + citations + followups) out, with the
 *                       token spend reported so the WorkQueue can record it.
 *
 * GeminiResearchProvider uses grounded Google Search (and is the place to add a
 * Semantic Scholar tool); MockResearchProvider keeps the system runnable and
 * tests deterministic offline — its digest is explicitly canned, never fake-real.
 */
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { Answer, Citation, Digest, type Citation as CitationT } from "../types";

export interface ResearchInput {
  question: string;
  /** The current page text or recent passage, if any. */
  pageText?: string;
  /** A condensed dossier brief (summary + themes), if a dossier exists. */
  dossierBrief?: string;
}

export interface ResearchProvider {
  research(input: ResearchInput): Promise<Answer>;
}

export interface DigestResearchInput {
  question: string;
  /** Extracts of the Captures attached to the job, if any. */
  captureExtracts?: string[];
  /** The owning Thread's topic, for context. */
  threadTopic?: string;
}

export interface DigestResearchResult {
  digest: Digest;
  /** Tokens actually spent; the WorkQueue records this on the ResearchJob. */
  tokensUsed: number;
}

/** The background half of the research seam — what a ResearchJob runs. */
export interface DigestResearchProvider {
  researchDigest(input: DigestResearchInput): Promise<DigestResearchResult>;
}

const RESEARCH_SYSTEM = `You are the research half of a reading companion. The user is mid-read and will hear your answer aloud.
Answer in at most 60 words of plain conversational prose. No markdown, no lists, no asterisks. Lead with substance, no preambles.
Use grounded search for claims beyond the passage. Never say "see the link"; citations are surfaced separately.`;

function buildPrompt(input: ResearchInput): string {
  const parts: string[] = [];
  if (input.dossierBrief) parts.push(`About this work: ${input.dossierBrief}`);
  if (input.pageText) parts.push(`Current passage:\n${input.pageText}`);
  parts.push(`Question: ${input.question}`);
  return parts.join("\n\n");
}

function extractCitations(response: GenerateContentResponse): CitationT[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const citations: CitationT[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri || seen.has(web.uri)) continue;
    const parsed = Citation.safeParse({ title: web.title ?? web.uri, url: web.uri });
    if (!parsed.success) continue; // drop a malformed grounding entry, keep the rest
    seen.add(web.uri);
    citations.push(parsed.data);
    if (citations.length >= 6) break;
  }
  return citations;
}

const DIGEST_SYSTEM = `You are the background-research half of a thought partner. The user asked a question, kept living, and you now report back.
Structure your answer EXACTLY as:
- First paragraph: a TLDR of at most two short spoken-prose sentences (heard aloud — no markdown, no lists).
- A blank line, then the full findings in plain prose paragraphs (read on a phone).
- Then up to three lines, each starting exactly "FOLLOWUP: ", each one natural follow-up question.
Use grounded search for every claim. Never say "see the link"; citations are surfaced separately.`;

function buildDigestPrompt(input: DigestResearchInput): string {
  const parts: string[] = [];
  if (input.threadTopic) parts.push(`Thread topic: ${input.threadTopic}`);
  if (input.captureExtracts?.length) parts.push(`Captured context:\n${input.captureExtracts.join("\n---\n")}`);
  parts.push(`Research question: ${input.question}`);
  return parts.join("\n\n");
}

export class GeminiResearchProvider implements ResearchProvider, DigestResearchProvider {
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async research(input: ResearchInput): Promise<Answer> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      config: { systemInstruction: RESEARCH_SYSTEM, tools: [{ googleSearch: {} }] },
    });
    return Answer.parse({ text: response.text?.trim() ?? "", citations: extractCitations(response) });
  }

  async researchDigest(input: DigestResearchInput): Promise<DigestResearchResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: buildDigestPrompt(input) }] }],
      config: { systemInstruction: DIGEST_SYSTEM, tools: [{ googleSearch: {} }] },
    });
    const text = response.text?.trim() ?? "";
    if (!text) throw new Error("Research digest returned an empty response.");

    const lines = text.split("\n");
    const followups = lines
      .filter((line) => line.startsWith("FOLLOWUP:"))
      .map((line) => line.slice("FOLLOWUP:".length).trim())
      .filter((line) => line.length > 0)
      .slice(0, 3);
    const prose = lines.filter((line) => !line.startsWith("FOLLOWUP:")).join("\n").trim();
    const blankSplit = prose.indexOf("\n\n");
    const tldr = (blankSplit === -1 ? prose : prose.slice(0, blankSplit)).trim();
    const body = (blankSplit === -1 ? prose : prose.slice(blankSplit + 2)).trim();

    const citations = extractCitations(response);
    return {
      digest: Digest.parse({
        tldr,
        body,
        citations,
        // Documented heuristic: grounded answers with sources score higher than ungrounded ones.
        confidence: citations.length > 0 ? 0.8 : 0.5,
        followups,
      }),
      tokensUsed: response.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}

export interface MockResearchOptions {
  /**
   * Artificial delay for researchDigest so background work feels like background
   * work in live demos (the server passes ~2.5 s). Tests keep the default 0.
   */
  digestDelayMs?: number;
}

export class MockResearchProvider implements ResearchProvider, DigestResearchProvider {
  constructor(private readonly options: MockResearchOptions = {}) {}

  async research(input: ResearchInput): Promise<Answer> {
    return Answer.parse({ text: `(mock research) Regarding: ${input.question}`, citations: [] });
  }

  async researchDigest(input: DigestResearchInput): Promise<DigestResearchResult> {
    const delay = this.options.digestDelayMs ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      digest: Digest.parse({
        tldr: `Mock digest ready on ${input.question}. Three canned offline sources back this stand-in.`,
        body:
          `(mock digest body) Deterministic offline findings for "${input.question}".` +
          (input.captureExtracts?.length ? ` Considered ${input.captureExtracts.length} capture extract(s).` : ""),
        citations: [
          { title: "Mock Journal of Offline Research", url: "https://example.com/mock-journal" },
          { title: "Canned Review of Background Work", url: "https://example.com/canned-review" },
          { title: "Deterministic Findings Quarterly", url: "https://example.com/findings-quarterly" },
        ],
        confidence: 0.9,
        followups: ["Want me to go deeper on any source?", "Should I watch for new papers on this?"],
      }),
      tokensUsed: 1234,
    };
  }
}
