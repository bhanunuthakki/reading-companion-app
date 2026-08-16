export * from "./resolver";
export * from "./enricher";
export { OpenLibraryBookSource, OpenLibraryCatalog } from "./sources/openLibrary";
export { ItunesMediaSource } from "./sources/itunes";
export { GeminiReceptionSource } from "./sources/geminiReception";

import type { EnrichmentSource } from "./enricher";
import type { ContentCatalog } from "./resolver";
import { OpenLibraryBookSource, OpenLibraryCatalog } from "./sources/openLibrary";
import { ItunesMediaSource } from "./sources/itunes";
import { GeminiReceptionSource } from "./sources/geminiReception";

export interface EnrichmentEnv {
  geminiApiKey?: string;
  geminiModel?: string;
}

/** No-key sources always; the grounded-reception source only when a key exists. */
export function defaultEnrichmentSources(env: EnrichmentEnv): EnrichmentSource[] {
  const sources: EnrichmentSource[] = [new OpenLibraryBookSource(), new ItunesMediaSource()];
  if (env.geminiApiKey) {
    sources.push(new GeminiReceptionSource(env.geminiApiKey, env.geminiModel ?? "gemini-2.5-flash"));
  }
  return sources;
}

/** Catalog used during resolution to canonicalize a fuzzy title. */
export function defaultCatalog(): ContentCatalog {
  return new OpenLibraryCatalog();
}
