/**
 * The companion's tools and the voice system prompt.
 *
 * READING_COMPANION_TOOLS are the function declarations handed to the
 * VoiceSession; ToolDispatcher executes a tool call against the session and the
 * research provider. The system prompt is the ambient-research-partner framing
 * from staged-roadmap.md (silent by default, dispatches research on request).
 */
import { z } from "zod";
import type { SessionManager } from "../sessionManager";
import type { ResearchProvider } from "./dispatcher";
import type { ToolSpec, ToolCallRequest, ToolCallResult } from "../voice/voiceSession";

export const READING_COMPANION_SYSTEM_PROMPT = `You are a warm, attentive reading companion — the smart friend in the chair next to the reader who happens to have the whole academic literature at hand.
You are SILENT by default. The user is reading or listening; their attention is on the work, not on you.
When the user asks something, be brief and conversational (you are heard aloud). Use your tools — do not answer factual or research questions from memory:
- define for a word, translate for a phrase, summarize_so_far for "what have we covered", lookup_context for "who/what is this again", watch to set a standing alert, bookmark to mark a spot.
After answering, stop talking. Offer to continue only if asked.
If the user speaks while you are talking, stop immediately and listen.`;

export const READING_COMPANION_TOOLS: ToolSpec[] = [
  {
    name: "define",
    description: "Define a word or short phrase the reader asks about.",
    parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
  },
  {
    name: "summarize_so_far",
    description: "Summarize what has been read/heard and discussed in this session so far.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "translate",
    description: "Translate text into a target language.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, target_lang: { type: "string" } },
      required: ["text", "target_lang"],
    },
  },
  {
    name: "bookmark",
    description: "Mark the current spot so the reader can return to it later.",
    parameters: { type: "object", properties: { label: { type: "string" } } },
  },
  {
    name: "lookup_context",
    description: "Recall who or what a reference is, using earlier session context and the dossier.",
    parameters: { type: "object", properties: { reference: { type: "string" } }, required: ["reference"] },
  },
  {
    name: "watch",
    description: "Set a standing watcher that alerts the reader when a topic recurs later.",
    parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  },
];

export const ToolName = z.enum([
  "define",
  "summarize_so_far",
  "translate",
  "bookmark",
  "lookup_context",
  "watch",
]);
export type ToolName = z.infer<typeof ToolName>;

function describeCursor(manager: SessionManager): string {
  const c = manager.current.cursor;
  return c.type === "page" ? `page ${c.pageId || "?"}` : `${Math.round(c.offsetSeconds)}s`;
}

function dossierBrief(manager: SessionManager): string | undefined {
  const d = manager.current.dossier;
  if (!d) return undefined;
  return d.themes.length ? `${d.summary} Themes: ${d.themes.join(", ")}.` : d.summary;
}

function recentTurnsText(manager: SessionManager): string | undefined {
  const turns = manager.current.turns.slice(-4);
  if (turns.length === 0) return undefined;
  return turns.map((t) => `Q: ${t.question}\nA: ${t.answer.text}`).join("\n");
}

export class ToolDispatcher {
  constructor(
    private readonly manager: SessionManager,
    private readonly research: ResearchProvider,
  ) {}

  async handle(call: ToolCallRequest): Promise<ToolCallResult> {
    const name = ToolName.parse(call.name);
    const result = await this.run(name, call.args);
    return { id: call.id, name: call.name, result };
  }

  private async run(name: ToolName, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const brief = dossierBrief(this.manager);
    switch (name) {
      case "define": {
        const { word } = z.object({ word: z.string() }).parse(args);
        const answer = await this.research.research({ question: `Define "${word}" briefly.` });
        return { definition: answer.text, citations: answer.citations };
      }
      case "translate": {
        const { text, target_lang } = z.object({ text: z.string(), target_lang: z.string() }).parse(args);
        const answer = await this.research.research({ question: `Translate to ${target_lang}: ${text}` });
        return { translation: answer.text };
      }
      case "summarize_so_far": {
        const answer = await this.research.research({
          question: "Summarize what we've covered so far in a couple of sentences.",
          ...(brief ? { dossierBrief: brief } : {}),
          ...(recentTurnsText(this.manager) ? { pageText: recentTurnsText(this.manager) } : {}),
        });
        return { summary: answer.text };
      }
      case "lookup_context": {
        const { reference } = z.object({ reference: z.string() }).parse(args);
        const answer = await this.research.research({
          question: `In the context of what we've read, who or what is "${reference}"?`,
          ...(brief ? { dossierBrief: brief } : {}),
          ...(recentTurnsText(this.manager) ? { pageText: recentTurnsText(this.manager) } : {}),
        });
        return { context: answer.text, citations: answer.citations };
      }
      case "bookmark": {
        const { label } = z.object({ label: z.string().optional() }).parse(args);
        const location = describeCursor(this.manager);
        this.manager.addTurn("(bookmark)", {
          text: `Saved this spot${label ? `: ${label}` : ""}.`,
          citations: [],
        });
        return { saved: true, location, ...(label ? { label } : {}) };
      }
      case "watch": {
        const { topic } = z.object({ topic: z.string() }).parse(args);
        const watcher = this.manager.addWatcher(topic);
        return { watcherId: watcher.id, armed: true, topic };
      }
    }
  }
}
