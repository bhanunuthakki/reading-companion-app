/**
 * SessionManager — the persistent-session state machine.
 *
 * Owns one Session's lifecycle: open (new or resumed), engage (reading vs
 * listening by kind), advance the cursor (page for visual, time for audio),
 * pause for a question and resume, record turns and watchers, and persist. This
 * is the runtime behind persistent-sessions-ux.md.
 */
import { randomUUID } from "node:crypto";
import {
  newSession,
  isVisualKind,
  type Session,
  type ContentRef,
  type Answer,
  type ContentDossier,
  type PageText,
  type Watcher,
} from "./types";
import type { SessionStore } from "./sessionStore";

export class SessionManager {
  private pageSeq = 0;

  private constructor(
    private session: Session,
    private readonly store: SessionStore,
    /** True when this session was loaded from the store, not freshly created. */
    readonly resumed: boolean,
  ) {}

  static async open(ref: ContentRef, store: SessionStore, deviceId?: string): Promise<SessionManager> {
    const existing = await store.load(ref);
    const session = existing ?? newSession(ref, deviceId);
    if (deviceId) session.lastDeviceId = deviceId;
    return new SessionManager(session, store, existing !== null);
  }

  get current(): Session {
    return this.session;
  }

  /** Move from idle into active engagement (reading for visual, listening for audio). */
  begin(): void {
    this.session.state = isVisualKind(this.session.ref.kind) ? "reading" : "listening";
  }

  attachDossier(dossier: ContentDossier): void {
    this.session.dossier = dossier;
  }

  /** A new page was read (visual kinds only); advance the page cursor. */
  observePage(page: PageText): void {
    if (!isVisualKind(this.session.ref.kind)) {
      throw new Error("observePage is only valid for visual content (book/kindle).");
    }
    const pageId =
      page.pageIdHint ?? (page.pageNumber != null ? `p${page.pageNumber}` : `p${++this.pageSeq}`);
    this.session.cursor = { type: "page", pageId, paragraphIdx: 0, charOffset: 0 };
  }

  /** Playback advanced (audio kinds only); move the time cursor. */
  advanceAudio(offsetSeconds: number): void {
    if (isVisualKind(this.session.ref.kind)) {
      throw new Error("advanceAudio is only valid for audio content (audiobook/podcast).");
    }
    this.session.cursor = { type: "time", offsetSeconds };
  }

  pauseForQuestion(): void {
    this.session.state = "paused_q";
  }

  resume(): void {
    this.begin();
  }

  addTurn(question: string, answer: Answer): void {
    this.session.turns.push({ id: randomUUID(), at: new Date().toISOString(), question, answer });
  }

  addWatcher(topic: string): Watcher {
    const watcher: Watcher = {
      id: randomUUID(),
      topic,
      createdAt: new Date().toISOString(),
      status: "armed",
    };
    this.session.watchers.push(watcher);
    return watcher;
  }

  fireWatcher(id: string, location: string): void {
    const watcher = this.session.watchers.find((w) => w.id === id);
    if (!watcher) throw new Error(`No watcher with id ${id}.`);
    watcher.status = "fired";
    watcher.firedAt = new Date().toISOString();
    watcher.firedLocation = location;
  }

  end(): void {
    this.session.state = "ended";
  }

  async persist(): Promise<void> {
    this.session = await this.store.save(this.session);
  }
}
