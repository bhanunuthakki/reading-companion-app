/**
 * Critical-reception enrichment via Gemini grounded search. Key-gated.
 * Applies to every kind: it asks the web what the world says about this work and
 * captures the cited sources as reviews. This is the "published reviews"
 * dimension of the dossier middle-ground.
 */
import { GoogleGenAI } from "@google/genai";
import type { ContentRef, Review } from "../../types";
import type { DossierContribution, EnrichmentSource } from "../enricher";

function hostnameOf(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return uri;
  }
}

export class GeminiReceptionSource implements EnrichmentSource {
  readonly name = "reception";
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async contribute(ref: ContentRef): Promise<DossierContribution> {
    const who = ref.author ? `${ref.title} by ${ref.author}` : ref.title;
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `In 3 sentences, summarize the critical reception and main themes of the ${ref.kind} "${who}". Be specific and factual.`,
            },
          ],
        },
      ],
      config: { tools: [{ googleSearch: {} }] },
    });

    const summary = response.text?.trim();
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const reviews: Review[] = [];
    for (const chunk of chunks) {
      const web = chunk.web;
      if (!web?.uri) continue;
      reviews.push({ source: hostnameOf(web.uri), summary: web.title ?? web.uri, url: web.uri });
      if (reviews.length >= 5) break;
    }

    return {
      sourceName: this.name,
      ...(summary ? { summary } : {}),
      ...(reviews.length ? { reviews } : {}),
    };
  }
}
