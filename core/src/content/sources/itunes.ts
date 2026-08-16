/**
 * iTunes Search enrichment for podcast + audiobook content. No API key required.
 * Gives a description (summary), a genre (theme), and — for podcasts — the RSS
 * feed URL where a published transcript may live.
 */
import { z } from "zod";
import type { ContentRef } from "../../types";
import type { DossierContribution, EnrichmentSource } from "../enricher";

const ItunesResult = z.object({
  collectionName: z.string().optional(),
  trackName: z.string().optional(),
  artistName: z.string().optional(),
  feedUrl: z.string().optional(),
  primaryGenreName: z.string().optional(),
  description: z.string().optional(),
  longDescription: z.string().optional(),
});
type ItunesResult = z.infer<typeof ItunesResult>;

const ItunesResponse = z.object({ results: z.array(ItunesResult).default([]) });

async function searchItunes(term: string, entity: "podcast" | "audiobook"): Promise<ItunesResult | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return ItunesResponse.parse(json).results[0] ?? null;
}

export class ItunesMediaSource implements EnrichmentSource {
  readonly name = "itunes";

  async contribute(ref: ContentRef): Promise<DossierContribution> {
    if (ref.kind !== "podcast" && ref.kind !== "audiobook") return { sourceName: this.name };
    const term = [ref.title, ref.author].filter(Boolean).join(" ");
    const result = await searchItunes(term, ref.kind);
    if (!result) return { sourceName: this.name };

    const summary =
      result.longDescription ??
      result.description ??
      [result.collectionName ?? result.trackName, result.artistName].filter(Boolean).join(" — ");

    return {
      sourceName: this.name,
      ...(summary ? { summary } : {}),
      ...(result.primaryGenreName ? { themes: [result.primaryGenreName] } : {}),
    };
  }
}
