import { z } from 'zod';

/** Parse the model's final JSON {reply, confidence, sentiment, needs_staff_approval} with a safe fallback. Pure — unit tested. */

export type ModelReply = {
  reply: string;
  confidence: number;
  sentiment: 'negative' | 'neutral' | 'positive';
  needs_staff_approval: boolean;
  parsed: boolean;
};

const EMPTY_REPLY = "Sorry — I couldn't put an answer together. Could you rephrase, or ask for your account manager?";

const replySchema = z.object({
  reply: z.string().trim().min(1),
  confidence: z.union([z.number(), z.string()]).optional(),
  sentiment: z.string().optional(),
  needs_staff_approval: z.union([z.boolean(), z.string()]).optional(),
});

export function clampConfidence(v: unknown, d = 0.5): number {
  let n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace('%', '')) : NaN;
  if (!Number.isFinite(n)) return d;
  if (n > 1 && n <= 100) n = n / 100;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

function normSentiment(v: unknown): ModelReply['sentiment'] {
  const s = String(v ?? '').toLowerCase();
  if (s.startsWith('neg')) return 'negative';
  if (s.startsWith('pos')) return 'positive';
  return 'neutral';
}

/** Octo never claims to be human (SPEC §20.6). */
export function sanitizeReply(text: string) {
  return text
    .replace(/\bI(?:'m| am) (?:a |an )?(?:real )?(?:human|person)(?: being)?\b/gi, "I'm Octo, an AI assistant")
    .trim();
}

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
    const candidate = fenced ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (!candidate || !candidate.startsWith('{')) return null;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

export function parseModelReply(raw: string | null | undefined): ModelReply {
  const text = (raw ?? '').trim();
  if (!text) return { reply: EMPTY_REPLY, confidence: 0, sentiment: 'neutral', needs_staff_approval: false, parsed: false };
  const r = replySchema.safeParse(extractJson(text));
  if (!r.success) {
    // not JSON: use the text but treat it as low-confidence
    return { reply: sanitizeReply(text).slice(0, 4000), confidence: 0.5, sentiment: 'neutral', needs_staff_approval: false, parsed: false };
  }
  const nsa = r.data.needs_staff_approval;
  return {
    reply: sanitizeReply(r.data.reply).slice(0, 4000),
    confidence: clampConfidence(r.data.confidence),
    sentiment: normSentiment(r.data.sentiment),
    needs_staff_approval: typeof nsa === 'string' ? nsa.toLowerCase() === 'true' : !!nsa,
    parsed: true,
  };
}
