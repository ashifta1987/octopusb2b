import { after } from 'next/server';
import { json, problem } from '@/lib/api/problem';
import { getConnector } from '@/lib/connectors/registry';
import { acceptWooKeys, finishWooConnect } from '@/lib/connectors/woocommerce-connect';
import { wooConnectDeps } from '@/lib/connectors/woocommerce-server';
import { traceLog } from '@/lib/trace';

/**
 * POST /api/webhooks/connect/woocommerce — CONN S2: WooCommerce's key callback (application authentication endpoint). WooCommerce
 * sends the key pair the merchant just approved, with the single-use state we put in user_id. The keys are sealed at once; the
 * store is tested and our webhooks are set up right after the answer (after()). The body is never logged; errors name no key.
 * Must be reachable from merchants' servers (WAF) before CONNECTOR_WOOCOMMERCE=on.
 */
export const maxDuration = 60;
const MAX_BYTES = 16_384;

export async function POST(req: Request) {
  if (getConnector('woocommerce').status() !== 'ready') return problem(503, 'NOT_CONFIGURED', 'WooCommerce connections are not switched on.');
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BYTES) return problem(413, 'TOO_LARGE', 'The body is too large.');
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return problem(413, 'TOO_LARGE', 'The body is too large.');
  const deps = wooConnectDeps();
  const r = await acceptWooKeys(deps, raw, req.headers.get('content-type'));
  if (r.status !== 200 || !r.connectionId) {
    traceLog('warn', 'woocommerce_callback_refused', { status: r.status, reason: r.message });
    return problem(r.status, r.status === 400 ? 'INVALID_REQUEST' : 'TRY_LATER', r.message);
  }
  const id = r.connectionId;
  after(async () => {
    const f = await finishWooConnect(deps, id).catch((e) => ({ ok: false, message: e instanceof Error ? e.message.slice(0, 200) : 'error', webhooks: 0 }));
    traceLog(f.ok ? 'info' : 'warn', 'woocommerce_connect_finished', { connection: id, ok: f.ok, webhooks: f.webhooks });
  });
  return json({ ok: true });
}
