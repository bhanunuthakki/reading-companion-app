/**
 * MemoryIndex — cross-thread recall over Digests, Turns, and Capture extracts
 * ("what did I find out about X in March?").
 *
 * The interface is the seam: LexicalMemoryIndex is the offline implementation
 * (normalized-token TF-IDF cosine, no dependencies); an embedding-backed
 * implementation (on-phone embeddings per thought-partner-spec.md §12 Q3) can
 * replace it behind the same add/search contract without touching any caller.
 */
import { OFFLINE_EXTRACTION_MARKER, type CaptureStore } from "./capture";
import type { JobStore } from "./jobStore";
import type { ThreadStore } from "./threadStore";

export type MemoryEntryKind = "digest" | "turn" | "capture";

export interface MemoryEntry {
  threadId: string;
  kind: MemoryEntryKind;
  text: string;
  /** Id of the source document (jobId / turnId / captureId), for deep-linking later. */
  ref?: string;
}

export interface MemoryHit {
  threadId: string;
  kind: MemoryEntryKind;
  snippet: string;
  score: number;
}

export interface MemoryIndex {
  add(entry: MemoryEntry): void;
  /** Top-k entries ranked by relevance; entries with zero overlap are omitted. */
  search(query: string, k?: number): MemoryHit[];
}

const SNIPPET_LENGTH = 160;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1 / tokens.length);
  return tf;
}

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_LENGTH) return flat;
  const cut = flat.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > SNIPPET_LENGTH / 2 ? lastSpace : SNIPPET_LENGTH)}…`;
}

interface IndexedEntry {
  entry: MemoryEntry;
  tf: Map<string, number>;
}

export class LexicalMemoryIndex implements MemoryIndex {
  private readonly entries: IndexedEntry[] = [];
  /** term → number of entries containing it. */
  private readonly df = new Map<string, number>();

  add(entry: MemoryEntry): void {
    const tokens = tokenize(entry.text);
    if (tokens.length === 0) return;
    const tf = termFrequencies(tokens);
    for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    this.entries.push({ entry, tf });
  }

  search(query: string, k = 5): MemoryHit[] {
    const queryTf = termFrequencies(tokenize(query));
    if (queryTf.size === 0 || this.entries.length === 0) return [];

    const idf = (term: string): number => Math.log(1 + this.entries.length / (1 + (this.df.get(term) ?? 0)));
    const queryWeights = new Map<string, number>();
    for (const [term, tf] of queryTf) queryWeights.set(term, tf * idf(term));
    const queryNorm = Math.hypot(...queryWeights.values());

    const hits: MemoryHit[] = [];
    for (const { entry, tf } of this.entries) {
      let dot = 0;
      let docNormSq = 0;
      for (const [term, docTf] of tf) {
        const weight = docTf * idf(term);
        docNormSq += weight * weight;
        const queryWeight = queryWeights.get(term);
        if (queryWeight !== undefined) dot += weight * queryWeight;
      }
      if (dot <= 0) continue;
      const score = dot / (Math.sqrt(docNormSq) * queryNorm);
      hits.push({ threadId: entry.threadId, kind: entry.kind, snippet: snippetOf(entry.text), score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

/**
 * Rebuild the index from the durable stores at boot (the index itself is
 * in-memory). Offline capture markers are never indexed — they are absences,
 * not content. Returns the number of entries added.
 */
export async function seedMemoryIndex(
  memory: MemoryIndex,
  stores: { threads: ThreadStore; jobs: JobStore; captures: CaptureStore },
): Promise<number> {
  let count = 0;
  for (const thread of await stores.threads.all()) {
    for (const turn of thread.turns) {
      memory.add({ threadId: thread.id, kind: "turn", text: `${turn.question} ${turn.answer.text}`, ref: turn.id });
      count++;
    }
  }
  for (const job of await stores.jobs.list()) {
    if (!job.digest) continue;
    memory.add({ threadId: job.threadId, kind: "digest", text: `${job.digest.tldr} ${job.digest.body}`, ref: job.id });
    count++;
  }
  for (const capture of await stores.captures.list()) {
    if (!capture.threadId || capture.extract === OFFLINE_EXTRACTION_MARKER) continue;
    memory.add({ threadId: capture.threadId, kind: "capture", text: capture.extract, ref: capture.id });
    count++;
  }
  return count;
}
