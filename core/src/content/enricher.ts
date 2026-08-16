/**
 * ContentEnricher — the audio middle-ground (and book/Kindle context too).
 *
 * Instead of transcribing a podcast/audiobook live (expensive, battery-hungry,
 * a privacy surface) or only keeping a tiny rolling buffer (no recall), we run a
 * one-time fan-out the moment a session attaches to a recognizable Content and
 * cache a ContentDossier: a structured knowledge base ABOUT the work — its
 * summary, themes, critical reception, chapter/show-notes, and a published
 * transcript URL if one exists. The companion reasons over this at question time.
 *
 * Sources are independent and may be down; one failing source must not sink the
 * dossier, so failures go to `onError` (not silently swallowed) and the rest
 * still contribute.
 */
import { ContentDossier, type ContentRef, type Review, type Chapter } from "../types";

export interface DossierContribution {
  readonly sourceName: string;
  summary?: string;
  themes?: string[];
  reviews?: Review[];
  chapters?: Chapter[];
  transcriptUrl?: string;
}

export interface EnrichmentSource {
  readonly name: string;
  /** Best-effort contribution for this Content. Inapplicable sources return an empty contribution. */
  contribute(ref: ContentRef): Promise<DossierContribution>;
}

export type SourceErrorHandler = (sourceName: string, error: unknown) => void;

function hasContent(c: DossierContribution): boolean {
  return Boolean(
    c.summary ||
      (c.themes && c.themes.length) ||
      (c.reviews && c.reviews.length) ||
      (c.chapters && c.chapters.length) ||
      c.transcriptUrl,
  );
}

function dedupeStrings(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
    if (out.length >= cap) break;
  }
  return out;
}

function fallbackSummary(ref: ContentRef): string {
  return ref.author ? `${ref.title} by ${ref.author}` : ref.title;
}

function mergeContributions(ref: ContentRef, contributions: DossierContribution[]): ContentDossier {
  const applicable = contributions.filter(hasContent);

  const summaries = applicable.map((c) => c.summary).filter((s): s is string => Boolean(s));
  const summary =
    summaries.sort((a, b) => b.length - a.length)[0] ?? fallbackSummary(ref);

  const themes = dedupeStrings(applicable.flatMap((c) => c.themes ?? []), 12);

  const reviewSeen = new Set<string>();
  const reviews: Review[] = [];
  for (const r of applicable.flatMap((c) => c.reviews ?? [])) {
    const key = `${r.source}::${r.summary}`.toLowerCase();
    if (reviewSeen.has(key)) continue;
    reviewSeen.add(key);
    reviews.push(r);
    if (reviews.length >= 10) break;
  }

  // Don't interleave conflicting chapter lists — take the richest single source.
  const chapters = applicable
    .map((c) => c.chapters ?? [])
    .sort((a, b) => b.length - a.length)[0];
  const sortedChapters: Chapter[] = (chapters ?? []).slice().sort((a, b) => a.index - b.index);

  const transcriptUrl = applicable.find((c) => c.transcriptUrl)?.transcriptUrl;
  const sources = dedupeStrings(
    applicable.map((c) => c.sourceName),
    applicable.length,
  );

  return ContentDossier.parse({
    ref,
    summary,
    themes,
    reviews,
    chapters: sortedChapters,
    ...(transcriptUrl ? { transcriptUrl } : {}),
    sources,
    builtAt: new Date().toISOString(),
  });
}

export class ContentEnricher {
  private readonly onError: SourceErrorHandler;

  constructor(
    private readonly sources: EnrichmentSource[],
    onError: SourceErrorHandler = (name, err) =>
      console.warn(`Enrichment source "${name}" failed:`, err),
  ) {
    this.onError = onError;
  }

  async build(ref: ContentRef): Promise<ContentDossier> {
    const settled = await Promise.allSettled(this.sources.map((s) => s.contribute(ref)));
    const contributions: DossierContribution[] = [];
    settled.forEach((result, i) => {
      const source = this.sources[i];
      if (!source) return;
      if (result.status === "fulfilled") contributions.push(result.value);
      else this.onError(source.name, result.reason);
    });
    return mergeContributions(ref, contributions);
  }
}
