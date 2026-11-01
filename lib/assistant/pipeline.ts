import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getChatAdapter, type ChatMessage } from '@/lib/adapters/ai-chat';
import { buildContext } from './context';
import { detectEscalation, handoffReply, officeHoursLabel } from './escalation';
import { redactText } from './redact';
import { parseModelReply } from './reply-parse';
import { getAssistantSettings } from './settings';
import { TOOL_DEFINITIONS } from './tool-schemas';
import { executeTool } from './tools';
import { getAccountTeam } from './team';
import { MESSAGE_COLUMNS, type AssistantDraft, type AssistantMessage, type ReplyResponse, type ToolCallLog } from './types';

/** Octo reply pipeline (SPEC §20.2, §20.6, §20.7 item 2). Customer client for everything the customer may see; service role only for record_bot_reply/escalate_session. */

export class AssistantError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const MODEL_TIMEOUT_MS = 20_000;
const MAX_TOOL_ROUNDS = 4;
const HISTORY = 16;

const DB_ERRORS: Record<string, [number, string]> = {
  RATE_LIMITED: [429, "You're sending messages very quickly — please wait a minute and try again."],
  SESSION_CLOSED: [409, 'This conversation is closed. Start a new conversation to continue.'],
  INVALID_MESSAGE: [400, 'Please type a message (up to 4,000 characters).'],
  NOT_FOUND: [404, 'Conversation not found.'],
  ASSISTANT_DISABLED: [503, 'Octo is switched off right now. Please contact your account manager.'],
  NO_ORG: [400, 'Please complete your company profile first.'],
};
function dbError(e: { message?: string }): AssistantError {
  const code = (e.message ?? '').split(':')[0].trim();
  const m = DB_ERRORS[code];
  return m ? new AssistantError(m[0], m[1], code) : new AssistantError(500, 'Something went wrong. Please try again.', code);
}

export type ReplyInput = {
  sb: SupabaseClient;
  admin: SupabaseClient;
  orgId: string;
  sessionId?: string | null;
  message: string;
  page?: string | null;
  channel?: 'page' | 'drawer' | 'api';
  preferHuman?: boolean;
};

function systemPrompt(o: { orgName: string; manager: string | null; context: string; today: string }) {
  return [
    `You are Octo, the AI account assistant of Octopus B2B (a B2B sourcing marketplace). You are an AI, never claim or imply to be human.`,
    `You are talking with the customer company "${o.orgName}". Their dedicated human account manager is ${o.manager ?? 'their account team'}. Today is ${o.today}.`,
    '',
    'Rules:',
    '- Answer only from the CUSTOMER CONTEXT below and from tool results. If something is not there, say so; never guess numbers, dates, prices or statuses.',
    '- For shipment/tracking questions call get_shipment, for quote comparisons call list_quotes, for group buys call list_pools, for T&C questions call get_terms_section — they return live detail and a link for the customer.',
    '- Quote tool outputs faithfully (codes, amounts with currency, dates). Give carrier ETAs only as the carrier reported them — never promise delivery dates.',
    '- For shipments always state the order code, carrier, tracking number, the last scan (status, place, time) and the carrier ETA if known.',
    '- Suppliers are identified only by their supplier code (e.g. OCT-1115). Never mention supplier names, margins, costs, staff data or other customers.',
    '- You cannot approve or promise money, refunds, credit notes, discounts, payouts, price or T&C changes, KYC decisions, or give legal/tax/customs advice. For those set needs_staff_approval=true and say the account manager will handle it.',
    '- To open an RFQ, sample, QC or other service request, use draft_rfq / draft_service_request. They only create a draft; tell the customer to review the card and click Confirm. Never say it was submitted.',
    '- Be concise and friendly (2–6 short sentences or a short list). Plain text, no markdown headings.',
    '',
    'Reply ONLY with a JSON object: {"reply": string, "confidence": number 0..1 (how sure you are the answer is correct and complete from the data), "sentiment": "negative"|"neutral"|"positive" (the customer\'s mood), "needs_staff_approval": boolean}.',
    '',
    '=== CUSTOMER CONTEXT (their own records, redacted) ===',
    o.context,
  ].join('\n');
}

function toHistory(rows: AssistantMessage[]): ChatMessage[] {
  return rows.map((m): ChatMessage => {
    const content = redactText(m.content);
    if (m.author === 'customer') return { role: 'user', content };
    if (m.author === 'staff') return { role: 'assistant', content: `[Account manager replied] ${content}` };
    if (m.author === 'system') return { role: 'assistant', content: `[System notice] ${content}` };
    return { role: 'assistant', content };
  });
}

async function newMessages(sb: SupabaseClient, sessionId: string, since: string): Promise<AssistantMessage[]> {
  const { data } = await sb.from('assistant_messages').select(MESSAGE_COLUMNS).eq('session_id', sessionId).gte('created_at', since).order('created_at');
  return (data ?? []) as AssistantMessage[];
}

async function escalate(admin: SupabaseClient, sessionId: string, reason: string, excerpt: string, confidence: number | null) {
  const { error } = await admin.rpc('escalate_session', { p_session: sessionId, p_reason: reason, p_excerpt: excerpt.slice(0, 1000), p_confidence: confidence });
  if (error) console.error('[assistant] escalate_session failed', error.message);
  return !error;
}

export async function runReply(i: ReplyInput): Promise<ReplyResponse> {
  const settings = await getAssistantSettings();
  if (!settings.enabled) throw new AssistantError(503, DB_ERRORS.ASSISTANT_DISABLED[1], 'ASSISTANT_DISABLED');
  const { sb, admin } = i;
  const page = i.page?.slice(0, 300) ?? null;

  // 1. session
  let sessionId = i.sessionId ?? null;
  if (sessionId) {
    const { data } = await sb.from('assistant_sessions').select('id').eq('id', sessionId).maybeSingle();
    if (!data) throw new AssistantError(404, DB_ERRORS.NOT_FOUND[1], 'NOT_FOUND');
  } else {
    const { data, error } = await sb.rpc('start_assistant_session', { p_channel: i.channel ?? 'page', p_page: page });
    if (error) throw dbError(error);
    sessionId = data as string;
  }

  // 2. customer message (rate limit + validation inside the RPC)
  const { data: msgId, error: postErr } = await sb.rpc('post_customer_message', { p_session: sessionId, p_content: i.message, p_page: page });
  if (postErr) throw dbError(postErr);
  const { data: posted } = await sb.from('assistant_messages').select('created_at').eq('id', msgId as string).single();
  const since = (posted?.created_at as string) ?? new Date(Date.now() - 1000).toISOString();
  const done = async (escalated: boolean, draft?: AssistantDraft | null): Promise<ReplyResponse> =>
    ({ session_id: sessionId!, messages: await newMessages(sb, sessionId!, since), escalated, draft: draft ?? null });

  const { data: sess } = await sb.from('assistant_sessions').select('status').eq('id', sessionId).single();
  // already with a human → the account manager answers; Octo stays quiet
  if (sess && ['escalated', 'human'].includes(sess.status as string)) return done(true);

  const team = await getAccountTeam(sb);

  // 3a. escalation pre-checks
  const pre = detectEscalation({ text: i.message, topics: settings.topics, vipIds: settings.vipIds, orgId: i.orgId, hours: settings.officeHours, preferHuman: i.preferHuman });
  if (pre) {
    const text = handoffReply(pre, team?.name ?? null, officeHoursLabel(settings.officeHours));
    await admin.rpc('record_bot_reply', { p_session: sessionId, p_content: text, p_confidence: null, p_tools: [], p_latency_ms: 0, p_tokens: 0 });
    await escalate(admin, sessionId, pre.reason, redactText(i.message), null);
    return done(true);
  }

  // 3b. context + history (customer's own rows via RLS)
  const [{ text: context }, { data: org }, { data: hist }] = await Promise.all([
    buildContext(sb, i.orgId),
    sb.from('organizations').select('name').eq('id', i.orgId).maybeSingle(),
    sb.from('assistant_messages').select(MESSAGE_COLUMNS).eq('session_id', sessionId).order('created_at', { ascending: false }).limit(HISTORY),
  ]);
  const history = toHistory(((hist ?? []) as AssistantMessage[]).reverse());
  const pageNote = page ? `\n\nThe customer is currently viewing ${page}.` : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt({ orgName: (org?.name as string) ?? 'the customer', manager: team?.name ?? null, context, today: new Date().toISOString().slice(0, 10) }) + pageNote },
    ...history,
  ];

  // 3c/d. model with tools, 20 s budget
  const adapter = getChatAdapter();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
  const t0 = Date.now();
  const tools: ToolCallLog[] = [];
  const mustQuote: string[] = []; // facts the reply must always contain (e.g. tracking numbers)
  let tokens = 0;
  let final: string | null = null;
  let draft: AssistantDraft | null = null;
  let failure: 'timeout' | 'error' | null = null;
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await adapter.complete({ messages, tools: round < MAX_TOOL_ROUNDS ? TOOL_DEFINITIONS : undefined, json: true, signal: ctrl.signal });
      tokens += res.tokens;
      if (!res.toolCalls.length) { final = res.content; break; }
      messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const r = await executeTool(sb, call.name, call.arguments);
        tools.push(r.log);
        if (call.name === 'get_shipment') {
          const m = r.output.match(/tracking ([A-Z0-9-]{6,})/);
          if (m) mustQuote.push(m[1]);
        }
        if (r.draft) draft = r.draft;
        messages.push({ role: 'tool', tool_call_id: call.id, content: r.output.slice(0, 6000) });
      }
    }
  } catch (e) {
    failure = ctrl.signal.aborted ? 'timeout' : 'error';
    console.error('[assistant] model call failed', (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
  const latency = Date.now() - t0;

  if (failure) {
    const text = failure === 'timeout'
      ? `I'm handing you to your account manager${team ? `, ${team.first_name}` : ''} — I couldn't get you a reliable answer quickly enough. They'll reply here.`
      : `I'm handing you to your account manager${team ? `, ${team.first_name}` : ''} — my answer service is unavailable right now. They'll reply here.`;
    await admin.rpc('record_bot_reply', { p_session: sessionId, p_content: text, p_confidence: 0, p_tools: tools, p_latency_ms: latency, p_tokens: tokens });
    await escalate(admin, sessionId, 'timeout', redactText(i.message), 0);
    return done(true);
  }

  // 3e. record + post-checks
  const parsed = parseModelReply(final);
  // Shipment answers always carry the carrier tracking number (SPEC §20 done-when: "real tracking data").
  for (const t of mustQuote) if (!parsed.reply.includes(t)) parsed.reply = `${parsed.reply.trim()} Tracking number: ${t}.`;
  const { data: rec, error: recErr } = await admin.rpc('record_bot_reply', {
    p_session: sessionId, p_content: parsed.reply, p_confidence: parsed.confidence, p_tools: tools, p_latency_ms: latency, p_tokens: tokens,
  });
  if (recErr) throw new AssistantError(500, 'Octo could not save its reply. Please try again.');
  const r = (rec ?? {}) as { should_escalate_low_confidence?: boolean };
  const reason = r.should_escalate_low_confidence ? 'low_confidence'
    : parsed.sentiment === 'negative' ? 'negative_sentiment'
    : parsed.needs_staff_approval ? 'needs_approval'
    : null;
  let escalated = false;
  if (reason) escalated = await escalate(admin, sessionId, reason, redactText(i.message), parsed.confidence);
  return done(escalated, draft);
}
