/**
 * ContentResolver — turn whatever cues we have into a canonical ContentRef.
 *
 * Cues differ by kind:
 *   - book/kindle: OCR of the cover/title page, an ISBN, or the user just saying it.
 *   - audiobook:   app/library metadata, or the user saying it.
 *   - podcast:     RSS/app metadata (feedUrl + episodeGuid), or the user saying it.
 *
 * A ContentRef is the identity that keys the session and the dossier, so getting
 * it stable matters: the same book resolved on two devices must produce the same
 * ref. When a catalog is available we prefer its canonical title/author/isbn.
 */
import { z } from "zod";
import { ContentRef, ContentKind } from "../types";

export const ResolutionHints = z.object({
  kind: ContentKind,
  statedTitle: z.string().optional(),
  statedAuthor: z.string().optional(),
  isbn: z.string().optional(),
  feedUrl: z.string().url().optional(),
  episodeGuid: z.string().optional(),
  /** OCR text of a cover or title page, used to guess the title when not stated. */
  coverText: z.string().optional(),
});
export type ResolutionHints = z.infer<typeof ResolutionHints>;

export interface ContentCatalog {
  /** Best canonical match for these hints, or null if nothing confident. */
  lookup(hints: ResolutionHints): Promise<ContentRef | null>;
}

function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export class ContentResolver {
  constructor(private readonly catalog?: ContentCatalog) {}

  async resolve(hints: ResolutionHints): Promise<ContentRef> {
    if (this.catalog) {
      try {
        const found = await this.catalog.lookup(hints);
        if (found) return ContentRef.parse(found);
      } catch (err) {
        // Catalog is best-effort; degrade to hint-derived resolution rather than fail.
        console.warn("Content catalog lookup failed; falling back to hints:", err);
      }
    }

    const title = hints.statedTitle ?? firstLine(hints.coverText);
    if (!title) {
      throw new Error("Could not resolve content: no title from hints or catalog.");
    }

    return ContentRef.parse({
      kind: hints.kind,
      title,
      ...(hints.statedAuthor ? { author: hints.statedAuthor } : {}),
      ...(hints.isbn ? { isbn: hints.isbn } : {}),
      ...(hints.feedUrl ? { feedUrl: hints.feedUrl } : {}),
      ...(hints.episodeGuid ? { episodeGuid: hints.episodeGuid } : {}),
    });
  }
}
