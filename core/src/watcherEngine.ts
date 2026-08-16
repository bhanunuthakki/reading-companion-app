/**
 * WatcherEngine — fires standing watchers when their topic recurs.
 *
 * A watcher is "programmable marginalia": the user says "tell me when she
 * revisits the spotlight effect," and when a later page (visual) or dossier
 * transcript segment (audio) contains that topic, the watcher fires. Matching is
 * keyword-coverage today; production would swap in embeddings/LLM for fuzzy
 * recurrence. Pure and deterministic so it's easy to test.
 */
import type { Watcher } from "./types";

export interface WatcherMatch {
  watcher: Watcher;
  location: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "to", "in", "on", "is", "it",
  "that", "this", "with", "for", "as", "at", "by", "be", "or",
]);

function keywords(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

export class WatcherEngine {
  /** Armed watchers whose every content keyword appears in `text`. */
  check(watchers: Watcher[], text: string, location: string): WatcherMatch[] {
    const haystack = text.toLowerCase();
    const matches: WatcherMatch[] = [];
    for (const watcher of watchers) {
      if (watcher.status !== "armed") continue;
      const words = keywords(watcher.topic);
      if (words.length === 0) continue;
      if (words.every((word) => haystack.includes(word))) {
        matches.push({ watcher, location });
      }
    }
    return matches;
  }
}
