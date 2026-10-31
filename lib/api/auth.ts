import 'server-only';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { hashApiKey, parseApiKey, verifyAccessToken, type KeyMode } from './keys';
import { problem } from './problem';

/**
 * Public API authentication (SPEC §7 Public API).
 *
 * Accepted credentials (Authorization header):
 *  - `Bearer <access token>` from POST /api/v1/oauth/token (client credentials, 1 h, HMAC-signed with WEBHOOK_SIGNING_SECRET)
 *  - `Bearer oct_test_…` / `Bearer oct_live_…` — an API key used directly
 *
 * All data access in API routes uses the service-role client (RLS is bypassed), so EVERY query must be filtered by
 * `ctx.orgId`, which comes only from the verified key/token — never from the request.
 *
 * Mode: `oct_test_` keys are sandbox keys. They may read the catalog and the org's own data; writes return realistic
 * simulated responses (`"simulated": true`) and do not touch business tables. Webhook endpoint management is the one
 * exception: it is configuration (not trade/money data) and is needed to test signed deliveries from the sandbox.
 * `oct_live_` keys require the organization's KYC to be verified (SPEC §4.9).
 */
export type ApiContext = {
  orgId: string;
  clientId: string; // api_clients.id
  clientPublicId: string; // api_clients.client_id (cli_…)
  keyId: string;
  scopes: string[];
  mode: KeyMode;
  sb: ReturnType<typeof createAdminClient>;
};

type KeyRow = {
  id: string;
  org_id: string;
  mode: KeyMode;
  revoked_at: string | null;
  last_used_at: string | null;
  client: { id: string; client_id: string; org_id: string; scopes: string[]; revoked_at: string | null } | null;
};

const KEY_SELECT = 'id, org_id, mode, revoked_at, last_used_at, client:api_clients(id, client_id, org_id, scopes, revoked_at)';

/** Looks up an active key by plaintext secret. Returns null if unknown/revoked/mismatched. */
export async function findActiveKey(sb: ReturnType<typeof createAdminClient>, key: string): Promise<KeyRow | null> {
  const parsed = parseApiKey(key);
  if (!parsed) return null;
  const { data } = await sb.from('api_keys').select(KEY_SELECT).eq('key_hash', hashApiKey(key)).maybeSingle();
  const row = data as unknown as KeyRow | null;
  if (!row || row.revoked_at || !row.client || row.client.revoked_at) return null;
  if (row.client.org_id !== row.org_id || row.mode !== parsed.mode) return null;
  return row;
}

async function liveAllowed(sb: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data } = await sb.from('organizations').select('kyc_status, archived_at').eq('id', orgId).maybeSingle();
  return !!data && !data.archived_at && data.kyc_status === 'verified';
}

function touch(sb: ReturnType<typeof createAdminClient>, row: Pick<KeyRow, 'id' | 'last_used_at'>) {
  if (row.last_used_at && Date.now() - new Date(row.last_used_at).getTime() < 5 * 60_000) return;
  after(async () => {
    await sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);
  });
}

const unauthorized = (detail: string) =>
  problem(401, 'UNAUTHORIZED', detail, { headers: { 'WWW-Authenticate': 'Bearer realm="octopusb2b", error="invalid_token"' } });

export async function authenticate(req: Request): Promise<ApiContext | Response> {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return unauthorized('Send "Authorization: Bearer <token>" (get a token from POST /api/v1/oauth/token, or use an API key).');
  const credential = m[1];
  const sb = createAdminClient();

  let ctx: ApiContext;
  if (credential.startsWith('oct_')) {
    const row = await findActiveKey(sb, credential);
    if (!row || !row.client) return unauthorized('Unknown or revoked API key.');
    touch(sb, row);
    ctx = { orgId: row.org_id, clientId: row.client.id, clientPublicId: row.client.client_id, keyId: row.id, scopes: row.client.scopes ?? [], mode: row.mode, sb };
  } else {
    const claims = verifyAccessToken(credential, process.env.WEBHOOK_SIGNING_SECRET ?? '');
    if (!claims) return unauthorized('Invalid or expired access token.');
    // Revocation check: the key/client behind the token must still be active.
    const { data } = await sb.from('api_keys').select(KEY_SELECT).eq('id', claims.kid).maybeSingle();
    const row = data as unknown as KeyRow | null;
    if (!row || row.revoked_at || !row.client || row.client.revoked_at || row.org_id !== claims.org || row.client.id !== claims.cid)
      return unauthorized('The credentials behind this token were revoked.');
    touch(sb, row);
    // Token scopes can only narrow the client's current scopes.
    const scopes = claims.scopes.filter((s) => (row.client!.scopes ?? []).includes(s));
    ctx = { orgId: claims.org, clientId: claims.cid, clientPublicId: claims.sub, keyId: claims.kid, scopes, mode: claims.mode, sb };
  }

  if (ctx.mode === 'live' && !(await liveAllowed(sb, ctx.orgId)))
    return problem(403, 'KYC_REQUIRED', 'Live keys work after your company KYC is verified. Use an oct_test_ key in the meantime.');
  return ctx;
}

/** True when the context holds at least one of the scopes. */
export function hasScope(ctx: Pick<ApiContext, 'scopes'>, ...anyOf: string[]) {
  return anyOf.length === 0 || anyOf.some((s) => ctx.scopes.includes(s));
}

export function requireScope(ctx: Pick<ApiContext, 'scopes'>, ...anyOf: string[]): Response | null {
  return hasScope(ctx, ...anyOf)
    ? null
    : problem(403, 'INSUFFICIENT_SCOPE', `This call needs one of these scopes: ${anyOf.join(', ')}.`, { required_scopes: anyOf });
}
