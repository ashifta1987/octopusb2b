import { findActiveKey } from '@/lib/api/auth';
import { signAccessToken, TOKEN_TTL_SECONDS } from '@/lib/api/keys';
import { json, problem } from '@/lib/api/problem';
import { rateHeaders, rateLimit } from '@/lib/api/rate-limit';
import { TokenRequest, zodIssues } from '@/lib/contracts';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * OAuth 2.0 client credentials (RFC 6749 §4.4).
 * client_id = api_clients.client_id (cli_…), client_secret = an API key (oct_test_… / oct_live_…) of that client.
 * Accepts application/x-www-form-urlencoded or JSON, and HTTP Basic client authentication.
 */
export async function POST(req: Request) {
  const input: Record<string, string> = {};
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) Object.assign(input, await req.json());
    else new URLSearchParams(await req.text()).forEach((v, k) => (input[k] = v));
  } catch {
    return oauthError(400, 'invalid_request', 'Body must be form-encoded or JSON.');
  }
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (basic) {
    const [id, ...rest] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
    input.client_id ??= decodeURIComponent(id);
    input.client_secret ??= decodeURIComponent(rest.join(':'));
  }
  input.grant_type ??= 'client_credentials';

  const parsed = TokenRequest.safeParse(input);
  if (!parsed.success) {
    const unsupported = input.grant_type !== 'client_credentials';
    return oauthError(400, unsupported ? 'unsupported_grant_type' : 'invalid_request', 'client_id and client_secret are required.', zodIssues(parsed.error));
  }
  const { client_id, client_secret, scope } = parsed.data;

  const rl = rateLimit(`token:${client_id}`, 30);
  if (!rl.ok) return problem(429, 'RATE_LIMITED', 'Too many token requests.', { headers: rateHeaders(rl) });

  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) return problem(503, 'NOT_CONFIGURED', 'Token signing is not configured on this server.');

  const sb = createAdminClient();
  const key = await findActiveKey(sb, client_secret);
  if (!key || !key.client || key.client.client_id !== client_id) return oauthError(401, 'invalid_client', 'Unknown client or wrong secret.');

  if (key.mode === 'live') {
    const { data: org } = await sb.from('organizations').select('kyc_status').eq('id', key.org_id).maybeSingle();
    if (org?.kyc_status !== 'verified') return oauthError(403, 'unauthorized_client', 'Live keys work after KYC is verified.');
  }

  const clientScopes = key.client.scopes ?? [];
  let scopes = clientScopes;
  if (scope) {
    const requested = scope.split(/[\s,]+/).filter(Boolean);
    const bad = requested.filter((s) => !clientScopes.includes(s));
    if (bad.length) return oauthError(400, 'invalid_scope', `Scopes not granted to this client: ${bad.join(', ')}`);
    scopes = requested;
  }

  const { token } = signAccessToken({ sub: key.client.client_id, cid: key.client.id, kid: key.id, org: key.org_id, scopes, mode: key.mode }, secret);
  await sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);
  return json(
    { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: scopes.join(' '), mode: key.mode },
    { headers: { Pragma: 'no-cache' } },
  );
}

function oauthError(status: number, error: string, description: string, errors?: unknown) {
  // RFC 6749 error fields + RFC 7807 fields so both kinds of clients can read it.
  return problem(status, error.toUpperCase(), description, { error, error_description: description, ...(errors ? { errors } : {}) });
}
