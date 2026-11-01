import 'server-only';
import OpenAI from 'openai';
import { traceAdapter } from './traced';

/**
 * Chat-with-tools adapter for Octo (SPEC §7 AiAdapter family, §20). OpenAI Chat Completions when OPENAI_API_KEY is set;
 * a deterministic rule-based mock otherwise (so the assistant works in dev/CI without a key).
 * Lives beside lib/adapters/ai.ts without changing its exports.
 */
export type ChatToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ChatToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatRequest = { messages: ChatMessage[]; tools?: ChatToolDef[]; json?: boolean; signal?: AbortSignal };
export type ChatResponse = { content: string | null; toolCalls: ChatToolCall[]; tokens: number };

export interface ChatAdapter {
  readonly mode: 'live' | 'mock';
  readonly model: string;
  complete(req: ChatRequest): Promise<ChatResponse>;
}

class OpenAiChatAdapter implements ChatAdapter {
  readonly mode = 'live' as const;
  readonly model = process.env.AI_MODEL || 'gpt-4o-mini';
  private client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1 });

  async complete({ messages, tools, json, signal }: ChatRequest): Promise<ChatResponse> {
    const r = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: messages.map((m) => {
          if (m.role === 'assistant') {
            return {
              role: 'assistant' as const,
              content: m.content,
              ...(m.tool_calls?.length
                ? { tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })) }
                : {}),
            };
          }
          if (m.role === 'tool') return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id };
          return { role: m.role, content: m.content };
        }),
        ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
        ...(json ? { response_format: { type: 'json_object' as const } } : {}),
      },
      { signal },
    );
    const msg = r.choices[0]?.message;
    const toolCalls: ChatToolCall[] = (msg?.tool_calls ?? [])
      .filter((t) => t.type === 'function')
      .map((t) => {
        const f = (t as { id: string; function: { name: string; arguments: string } });
        return { id: f.id, name: f.function.name, arguments: f.function.arguments };
      });
    return { content: msg?.content ?? null, toolCalls, tokens: r.usage?.total_tokens ?? 0 };
  }
}

/** Rule-based stand-in: picks a tool from keywords, then summarises tool output as the JSON reply contract. */
class MockChatAdapter implements ChatAdapter {
  readonly mode = 'mock' as const;
  readonly model = 'mock';

  async complete({ messages, signal }: ChatRequest): Promise<ChatResponse> {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const last = messages[messages.length - 1];
    const reply = (text: string, confidence = 0.8) => ({ content: JSON.stringify({ reply: text, confidence, sentiment: 'neutral', needs_staff_approval: false }), toolCalls: [], tokens: 0 });

    if (last.role === 'tool') {
      const outputs = messages.slice(messages.findLastIndex((m) => m.role === 'assistant')).filter((m) => m.role === 'tool').map((m) => m.content);
      return reply(`Here is what I found:\n${outputs.join('\n\n')}`, outputs.some((o) => o.startsWith('Tool error')) ? 0.4 : 0.85);
    }
    const text = last.role === 'user' ? last.content : '';
    const t = text.toLowerCase();
    const call = (name: string, args: Record<string, unknown>) => ({ content: null, toolCalls: [{ id: `mock_${Date.now()}`, name, arguments: JSON.stringify(args) }], tokens: 0 });
    const order = /\bORD-\d+\b/i.exec(text)?.[0] ?? /\b[A-Z]{2}\d{9,}[A-Z]{0,2}\b/.exec(text)?.[0] ?? /## Orders[^\n]*\n- (ORD-\d+)/.exec(system)?.[1];
    const rfq = /\bRFQ-\d+\b/i.exec(text)?.[0] ?? /## RFQs[^\n]*\n(?:- [^\n]*\n)*?- (RFQ-\d+)[^\n]*quote\(s\)/.exec(system)?.[1];

    if (/(track|shipment|where is|deliver|arriv|eta)/.test(t) && order) return call('get_shipment', { tracking_or_order: order });
    if (/(quote|compare)/.test(t) && rfq) return call('list_quotes', { rfq_id_or_code: rfq });
    if (/(pool|group[- ]buy)/.test(t)) return call('list_pools', {});
    const sec = /section\s+(\d+)/i.exec(text)?.[1];
    if (/(terms|t&c)/.test(t) && sec) return call('get_terms_section', { no: Number(sec) });
    if (/(sample|qc|inspection)/.test(t)) {
      return call('draft_service_request', { service_code: /sample/.test(t) ? 'sample' : 'qc', details: { product: text.slice(0, 120), notes: 'Drafted by Octo (mock mode)' } });
    }
    if (/(open|new|create|start).{0,12}rfq|request a quote/.test(t)) {
      return call('draft_rfq', { title: text.replace(/.*?(for|of)\s+/i, '').slice(0, 80) || 'New sourcing request', quantity: Number(/(\d[\d,]*)\s*(pcs|units|pieces)?/.exec(text)?.[1]?.replace(/,/g, '')) || 1000, details: text });
    }
    if (/(wallet|balance|top.?up)/.test(t)) {
      const w = /## Wallet\n([\s\S]*?)(\n\n|$)/.exec(system)?.[1] ?? 'No wallet yet.';
      return reply(`Your wallet:\n${w}\nYou can top up from Wallet → Top up.`, 0.8);
    }
    return reply("I'm Octo (running in demo mode without an AI key). I can track shipments, compare quotes, list group-buy pools, draft RFQs or service requests for you to confirm, and quote the T&C.", 0.55);
  }
}

/** Every model call is logged to integration_logs (trace id, request/response SHA only — no content) — SPEC §21.4 step 4. */
export function getChatAdapter(): ChatAdapter {
  const a = process.env.OPENAI_API_KEY ? new OpenAiChatAdapter() : new MockChatAdapter();
  return traceAdapter(a.mode === 'live' ? 'openai' : 'ai-mock', a, ['complete'], () => (a.mode === 'live' ? `https://api.openai.com/v1/chat/completions#${a.model}` : 'mock://chat'));
}
