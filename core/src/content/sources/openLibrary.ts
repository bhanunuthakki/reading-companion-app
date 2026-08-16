/**
 * Open Library enrichment for book/Kindle content. No API key required.
 * Doubles as a ContentCatalog so resolution can snap a fuzzy title to a
 * canonical title/author/ISBN.
 */
import { z } from "zod";
import { ContentRef, isVisualKind } from "../../types";
import type { DossierContribution, EnrichmentSource } from "../enricher";
import type { ContentCatalog, ResolutionHints } from "../resolver";

const OpenLibraryDoc = z.object({
  title: z.string().optional(),
  author_name: z.array(z.string()).optional(),
  first_sentence: z.array(z.string()).optional(),
  subject: z.array(z.string()).optional(),
  isbn: z.array(z.string()).optional(),
});
type OpenLibraryDoc = z.infer<typeof OpenLibraryDoc>;

const OpenLibraryResponse = z.object({ docs: z.array(OpenLibraryDoc).default([]) });

async function searchOpenLibrary(query: string): Promise<OpenLibraryDoc | null> {
  const url = `https://openlibrary.org/search.json?${query}&limit=1&fields=title,author_name,first_sentence,subject,isbn`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library search failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return OpenLibraryResponse.parse(json).docs[0] ?? null;
}

function queryFor(hints: { isbn?: string; title?: string; author?: string }): string | null {
  if (hints.isbn) return `isbn=${encodeURIComponent(hints.isbn)}`;
  if (hints.title) {
    const parts = [`title=${encodeURIComponent(hints.title)}`];
    if (hints.author) parts.push(`author=${encodeURIComponent(hints.author)}`);
    return parts.join("&");
  }
  return null;
}

export class OpenLibraryBookSource implements EnrichmentSource {
  readonly name = "openlibrary";

  async contribute(ref: ContentRef): Promise<DossierContribution> {
    if (!isVisualKind(ref.kind)) return { sourceName: this.name };
    const query = queryFor({
      ...(ref.isbn ? { isbn: ref.isbn } : {}),
      title: ref.title,
      ...(ref.author ? { author: ref.author } : {}),
    });
    if (!query) return { sourceName: this.name };

    const doc = await searchOpenLibrary(query);
    if (!doc) return { sourceName: this.name };

    return {
      sourceName: this.name,
      ...(doc.first_sentence?.[0] ? { summary: doc.first_sentence[0] } : {}),
      ...(doc.subject?.length ? { themes: doc.subject.slice(0, 12) } : {}),
    };
  }
}

export class OpenLibraryCatalog implements ContentCatalog {
  async lookup(hints: ResolutionHints): Promise<ContentRef | null> {
    if (!isVisualKind(hints.kind)) return null;
    const title = hints.statedTitle ?? hints.coverText?.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    const query = queryFor({
      ...(hints.isbn ? { isbn: hints.isbn } : {}),
      ...(title ? { title } : {}),
      ...(hints.statedAuthor ? { author: hints.statedAuthor } : {}),
    });
    if (!query) return null;

    const doc = await searchOpenLibrary(query);
    if (!doc?.title) return null;

    return ContentRef.parse({
      kind: hints.kind,
      title: doc.title,
      ...(doc.author_name?.[0] ? { author: doc.author_name[0] } : {}),
      ...(doc.isbn?.[0] ? { isbn: doc.isbn[0] } : {}),
    });
  }
}
