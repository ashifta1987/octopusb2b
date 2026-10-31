import crypto from 'node:crypto';

/**
 * API key + access token primitives (pure, no I/O — unit tested).
 * Keys: `oct_test_<48 hex>` / `oct_live_<48 hex>`. Only the sha256 hex digest is stored (api_keys.key_hash);
 * the plaintext key is shown to the customer once.
 */
export type KeyMode = 'test' | 'live';

const KEY_RE = /^oct_(test|live)_[0-9a-f]{32,128}$/;

export function generateApiKey(mode: KeyMode) {
  const key = `oct_${mode}_${crypto.randomBytes(24).toString('hex')}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 13), mode };
}

export function hashApiKey(key: string) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export function parseApiKey(key: string): { mode: KeyMode } | null {
  const m = KEY_RE.exec(key);
  return m ? { mode: m[1] as KeyMode } : null;
}

// ───────── Access tokens (OAuth2 client credentials) ─────────
// JWT-shaped (header.payload.signature, base64url, HS256) signed with WEBHOOK_SIGNING_SECRET.
export type TokenClaims = {
  iss: 'octopusb2b';
  sub: string; // api_clients.client_id
  cid: string; // api_clients.id
  kid: string; // api_keys.id used as client_secret
  org: string; // org id — every query is filtered by this
  scopes: string[];
  mode: KeyMode;
  iat: number;
  exp: number;
};

export const TOKEN_TTL_SECONDS = 3600;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signAccessToken(claims: Omit<TokenClaims, 'iss' | 'iat' | 'exp'>, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('WEBHOOK_SIGNING_SECRET is not set');
  const full: TokenClaims = { iss: 'octopusb2b', ...claims, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(full));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return { token: `${head}.${body}.${sig}`, claims: full };
}

export function verifyAccessToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)): TokenClaims | null {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const h = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    if (h.alg !== 'HS256') return null;
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    if (c.iss !== 'octopusb2b' || typeof c.exp !== 'number' || c.exp <= now) return null;
    if (!c.org || !c.cid || !c.kid || !Array.isArray(c.scopes) || (c.mode !== 'test' && c.mode !== 'live')) return null;
    return c;
  } catch {
    return null;
  }
}
