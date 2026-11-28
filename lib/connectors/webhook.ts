/**
 * CONN S1 · the connector webhook decision (pure; deps injected). The route reads the raw body and calls this; unit tests call it with
 * fakes. Order of checks: known platform with webhooks → known, not disconnected connection of THAT platform → sealed secret →
 * signature over the RAW body (constant time, in the connector) → JSON → inbox (dedupe on platform + event id). A bad signature is
 * recorded WITHOUT the payload (for the health card) and answered 401; nothing about the store or the secret is echoed back.
 */
import { isStorePlatform, type StorePlatform } from './platforms';
import type { Connector } from './types';

export const WEBHOOK_MAX_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WebhookDeps = {
  getConnector: (id: StorePlatform) => Connector;
  findConnection: (id: string) => Promise<{ id: string; platform: string; status: string } | null>;
  readSecret: (connectionId: string) => Promise<string | null>;
  receive: (input: { platform: StorePlatform; connectionId: string; eventId: string | null; topic: string | null; signatureOk: boolean; payload: unknown }) => Promise<{ id: string | null; duplicate: boolean }>;
};

export type WebhookOutcome =
  | { status: 200; body: { received: true; duplicate: boolean }; process: boolean }
  | { status: 400 | 401 | 404 | 410 | 413; code: string; detail: string };

export async function handleConnectorWebhook(deps: WebhookDeps, input: { platform: string; connection: string; headers: Record<string, string>; rawBody: string }): Promise<WebhookOutcome> {
  const notFound = { status: 404 as const, code: 'NOT_FOUND', detail: 'Unknown webhook address.' };
  if (!isStorePlatform(input.platform) || input.platform === 'shopify' || !UUID.test(input.connection)) return notFound;
  const connector = deps.getConnector(input.platform);
  if (!connector.verifyWebhook) return notFound;
  if (Buffer.byteLength(input.rawBody, 'utf8') > WEBHOOK_MAX_BYTES) return { status: 413, code: 'TOO_LARGE', detail: 'The body is larger than 1 MB.' };
  // the creation ping is unsigned and carries no data: answer it, store nothing (it can't trigger any work)
  if (connector.isPing?.({ headers: input.headers, rawBody: input.rawBody })) return { status: 200, body: { received: true, duplicate: false }, process: false };
  const conn = await deps.findConnection(input.connection);
  if (!conn || conn.platform !== input.platform) return notFound;
  // 410 tells platforms that honour it (WooCommerce) to delete the webhook: the merchant disconnected this store
  if (conn.status === 'disconnected') return { status: 410, code: 'GONE', detail: 'This store is no longer connected.' };
  const secret = await deps.readSecret(conn.id);
  const meta = connector.webhookMeta?.({ headers: input.headers, rawBody: input.rawBody }) ?? { eventId: null, topic: null };
  let ok = false;
  try { ok = !!secret && connector.verifyWebhook({ headers: input.headers, rawBody: input.rawBody, secret }); } catch { ok = false; }
  if (!ok) {
    await deps.receive({ platform: input.platform, connectionId: conn.id, eventId: null, topic: meta.topic, signatureOk: false, payload: null });
    return { status: 401, code: 'BAD_SIGNATURE', detail: 'Invalid signature.' };
  }
  let payload: unknown = null;
  if (input.rawBody.trim() !== '') {
    try { payload = JSON.parse(input.rawBody); } catch { return { status: 400, code: 'INVALID_JSON', detail: 'Body must be JSON.' }; }
  }
  const r = await deps.receive({ platform: input.platform, connectionId: conn.id, eventId: meta.eventId, topic: meta.topic, signatureOk: true, payload });
  return { status: 200, body: { received: true, duplicate: r.duplicate }, process: !r.duplicate };
}

/** Header names lowercased (platform signatures are looked up case-insensitively). */
export const headerRecord = (h: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
};
