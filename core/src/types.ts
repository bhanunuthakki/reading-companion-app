/**
 * Canonical domain schemas and types for the Reading Companion core.
 * Terms here are defined in ../../DEFINITIONS.md and used verbatim across the codebase.
 *
 * Every structured payload is a Zod schema; the matching TypeScript type is its
 * inferred output type (value + type share a name, the standard Zod pattern).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

// ── Content & sessions ──────────────────────────────────────────────────────

export const ContentKind = z.enum(["book", "kindle", "audiobook", "podcast"]);
export type ContentKind = z.infer<typeof ContentKind>;

/** book/kindle are read (image pipeline); audiobook/podcast are heard (rolling buffer). */
export function isVisualKind(kind: ContentKind): boolean {
  return kind === "book" || kind === "kindle";
}

export const ContentRef = z.object({
  kind: ContentKind,
  title: z.string().min(1),
  author: z.string().optional(),
  isbn: z.string().optional(),
  feedUrl: z.string().url().optional(),
  episodeGuid: z.string().optional(),
});
export type ContentRef = z.infer<typeof ContentRef>;

// ── Image pipeline (visual kinds) ───────────────────────────────────────────

export const Paragraph = z.object({
  text: z.string(),
  isHeading: z.boolean().default(false),
  isDialogue: z.boolean().default(false),
});
export type Paragraph = z.infer<typeof Paragraph>;

export const PageText = z.object({
  pageIdHint: z.string().optional(),
  pageNumber: z.number().int().optional(),
  paragraphs: z.array(Paragraph),
  confidence: z.number().min(0).max(1).default(1),
});
export type PageText = z.infer<typeof PageText>;

// ── Cursor (polymorphic position) ───────────────────────────────────────────

export const PageCursor = z.object({
  type: z.literal("page"),
  pageId: z.string(),
  paragraphIdx: z.number().int().nonnegative().default(0),
  charOffset: z.number().int().nonnegative().default(0),
});
export const TimeCursor = z.object({
  type: z.literal("time"),
  offsetSeconds: z.number().nonnegative().default(0),
});
export const Cursor = z.discriminatedUnion("type", [PageCursor, TimeCursor]);
export type Cursor = z.infer<typeof Cursor>;

// ── Research & history ──────────────────────────────────────────────────────

export const Citation = z.object({ title: z.string(), url: z.string().url() });
export type Citation = z.infer<typeof Citation>;

export const Answer = z.object({
  text: z.string(),
  citations: z.array(Citation).default([]),
});
export type Answer = z.infer<typeof Answer>;

export const Turn = z.object({
  id: z.string(),
  at: z.string(), // ISO 8601
  question: z.string(),
  answer: Answer,
});
export type Turn = z.infer<typeof Turn>;

// ── Watchers ────────────────────────────────────────────────────────────────

export const WatcherStatus = z.enum(["armed", "fired", "dismissed"]);
export type WatcherStatus = z.infer<typeof WatcherStatus>;

export const Watcher = z.object({
  id: z.string(),
  topic: z.string(),
  createdAt: z.string(),
  status: WatcherStatus.default("armed"),
  firedAt: z.string().optional(),
  firedLocation: z.string().optional(),
});
export type Watcher = z.infer<typeof Watcher>;

// ── Content dossier (all kinds) ─────────────────────────────────────────────

export const Review = z.object({
  source: z.string(),
  summary: z.string(),
  url: z.string().url().optional(),
  rating: z.number().optional(),
});
export type Review = z.infer<typeof Review>;

export const Chapter = z.object({
  index: z.number().int(),
  title: z.string(),
  summary: z.string().optional(),
});
export type Chapter = z.infer<typeof Chapter>;

export const ContentDossier = z.object({
  ref: ContentRef,
  summary: z.string(),
  themes: z.array(z.string()).default([]),
  reviews: z.array(Review).default([]),
  chapters: z.array(Chapter).default([]),
  transcriptUrl: z.string().url().optional(),
  sources: z.array(z.string()).default([]),
  builtAt: z.string(),
});
export type ContentDossier = z.infer<typeof ContentDossier>;

// ── Session ─────────────────────────────────────────────────────────────────

export const SessionState = z.enum(["idle", "reading", "listening", "paused_q", "ended"]);
export type SessionState = z.infer<typeof SessionState>;

export const EscalationLevel = z.enum(["idle", "alerted", "active"]);
export type EscalationLevel = z.infer<typeof EscalationLevel>;

export const Session = z.object({
  ref: ContentRef,
  key: z.string(),
  state: SessionState.default("idle"),
  cursor: Cursor,
  dossier: ContentDossier.optional(),
  turns: z.array(Turn).default([]),
  watchers: z.array(Watcher).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastDeviceId: z.string().optional(),
});
export type Session = z.infer<typeof Session>;

// ── Threads, jobs & delivery (thought-partner-spec.md §5) ──────────────────

export const CaptureKind = z.enum(["page", "document", "whiteboard", "screen", "scene", "object"]);
export type CaptureKind = z.infer<typeof CaptureKind>;

export const CaptureSource = z.enum(["glassesCamera", "phoneCamera"]);
export type CaptureSource = z.infer<typeof CaptureSource>;

/**
 * One contextual grab. The raw image is deliberately NOT part of the schema:
 * frames are discarded after extraction and only the text extract persists
 * (thought-partner-spec.md §9).
 */
export const Capture = z.object({
  id: z.string(),
  source: CaptureSource,
  kind: CaptureKind,
  extract: z.string(),
  ts: z.string(), // ISO 8601
  threadId: z.string().optional(),
});
export type Capture = z.infer<typeof Capture>;

export const JobState = z.enum(["queued", "running", "digest_ready", "delivered", "archived", "failed"]);
export type JobState = z.infer<typeof JobState>;

export const Digest = z.object({
  /** ≤2 spoken-prose sentences, plain text, no markdown — same rule as Answer.text. */
  tldr: z.string().min(1),
  /** Full findings; renders only on the phone. */
  body: z.string(),
  citations: z.array(Citation).default([]),
  confidence: z.number().min(0).max(1),
  followups: z.array(z.string()).default([]),
});
export type Digest = z.infer<typeof Digest>;

export const JobBudget = z.object({
  maxTokens: z.number().int().positive(),
  maxSeconds: z.number().positive(),
});
export type JobBudget = z.infer<typeof JobBudget>;

export const ResearchJob = z.object({
  id: z.string(),
  threadId: z.string(),
  question: z.string().min(1),
  captureIds: z.array(z.string()).default([]),
  state: JobState.default("queued"),
  budget: JobBudget,
  createdAt: z.string(),
  updatedAt: z.string(),
  digest: Digest.optional(),
  /** Tokens actually spent, as reported by the research provider (budget.maxTokens is the cap). */
  tokensUsed: z.number().int().nonnegative().optional(),
  /** Why the job reached state "failed". Secret-redacted before it is stored. */
  failure: z.string().optional(),
  /** "Tell me when you're back" — upgrades this job's delivery to speak (etiquette rule 4). */
  invited: z.boolean().default(false),
});
export type ResearchJob = z.infer<typeof ResearchJob>;

export const InterruptLevel = z.enum(["hold", "badge", "earcon", "speak"]);
export type InterruptLevel = z.infer<typeof InterruptLevel>;

/** InterruptLevels in ascending order. The DeliveryEngine may only round DOWN this ladder. */
export const INTERRUPT_LEVEL_ORDER: readonly InterruptLevel[] = ["hold", "badge", "earcon", "speak"];

export function interruptLevelIndex(level: InterruptLevel): number {
  return INTERRUPT_LEVEL_ORDER.indexOf(level);
}

export function minInterruptLevel(a: InterruptLevel, b: InterruptLevel): InterruptLevel {
  return interruptLevelIndex(a) <= interruptLevelIndex(b) ? a : b;
}

/** One step down the ladder; hold stays hold (never rounds up). */
export function roundDownInterruptLevel(level: InterruptLevel): InterruptLevel {
  return INTERRUPT_LEVEL_ORDER[Math.max(0, interruptLevelIndex(level) - 1)] ?? "hold";
}

/** A do-not-disturb window in local wall-clock time, "HH:MM"–"HH:MM"; may span midnight. */
export const DndWindow = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type DndWindow = z.infer<typeof DndWindow>;

/** Per-thread ceiling + global DND windows + the conversation-suppression flag (etiquette rule 1). */
export const DeliveryPolicy = z.object({
  ceiling: InterruptLevel.default("speak"),
  dndWindows: z.array(DndWindow).default([]),
  suppressWhileConversing: z.boolean().default(true),
});
export type DeliveryPolicy = z.infer<typeof DeliveryPolicy>;

export const Thread = z.object({
  id: z.string(),
  topic: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(Turn).default([]),
  jobIds: z.array(z.string()).default([]),
  /**
   * A Digest is stored on the ResearchJob that produced it, so digestIds lists
   * the jobIds whose digest is ready — one id namespace, no copies.
   */
  digestIds: z.array(z.string()).default([]),
  watchers: z.array(Watcher).optional(),
  /** The per-thread InterruptLevel ceiling (etiquette rule 7). */
  deliveryCeiling: InterruptLevel.default("speak"),
});
export type Thread = z.infer<typeof Thread>;

export function newThread(topic: string): Thread {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    topic,
    createdAt: now,
    updatedAt: now,
    turns: [],
    jobIds: [],
    digestIds: [],
    deliveryCeiling: "speak",
  };
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Lowercase, strip punctuation, collapse whitespace to single hyphens. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Stable, filesystem-safe identity for a Content. The same ContentRef yields the
 * same key on any device and any day, which is what makes resume work across
 * glances, days, and devices.
 */
export function sessionKey(ref: ContentRef): string {
  const discriminator = ref.isbn ?? ref.episodeGuid ?? ref.author ?? "";
  return `${ref.kind}__${normalize(ref.title)}__${discriminator ? normalize(discriminator) : "x"}`;
}

export function initialCursor(kind: ContentKind): Cursor {
  return isVisualKind(kind)
    ? { type: "page", pageId: "", paragraphIdx: 0, charOffset: 0 }
    : { type: "time", offsetSeconds: 0 };
}

export function newSession(ref: ContentRef, deviceId?: string): Session {
  const now = new Date().toISOString();
  return {
    ref,
    key: sessionKey(ref),
    state: "idle",
    cursor: initialCursor(ref.kind),
    turns: [],
    watchers: [],
    createdAt: now,
    updatedAt: now,
    ...(deviceId ? { lastDeviceId: deviceId } : {}),
  };
}
