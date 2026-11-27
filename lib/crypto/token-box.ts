import 'server-only';
import crypto from 'node:crypto';

/**
 * C0 · Token box — AES-256-GCM sealing for store tokens and merchant-pasted API keys (store_credentials, store_oauth_states).
 *
 * Keys come from the server environment only (set by the owner in Vercel / .env.local, never in the repo):
 *   CONNECTOR_TOKEN_KEY           32 random bytes, base64 (or base64url). One per environment (staging ≠ production).
 *   CONNECTOR_TOKEN_KEY_VERSION   the version number of CONNECTOR_TOKEN_KEY (1 … 99, default 1).
 *   CONNECTOR_TOKEN_KEY_PREVIOUS  optional: the previous key while rotating; ciphertext sealed with it still opens.
 *   CONNECTOR_TOKEN_KEY_PREVIOUS_VERSION  its version number.
 * Sealed text: "v<version>.<iv>.<tag>.<ciphertext>" (base64url; 12-byte IV, 16-byte tag). The database CHECK refuses anything else,
 * so a plain token can never be stored by mistake. The associated data binds a sealed value to its connection + kind, so a
 * ciphertext copied to another row does not open.
 *
 * Never log, return to the browser or put in an error message: the plain value, the key, or the sealed text.
 */
export class TokenBoxError extends Error {
  constructor(public readonly code: 'NO_KEY' | 'BAD_KEY' | 'BAD_SEALED' | 'UNKNOWN_KEY_VERSION' | 'OPEN_FAILED', message: string) {
    super(message);
    this.name = 'TokenBoxError';
  }
}

type Key = { version: number; key: Buffer };
const SEALED = /^v([0-9]{1,2})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/;

function decodeKey(raw: string | undefined, versionRaw: string | undefined, name: string): Key | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) throw new TokenBoxError('BAD_KEY', `${name} must be 32 random bytes in base64.`);
  const version = versionRaw ? Number(versionRaw) : 1;
  if (!Number.isInteger(version) || version < 1 || version > 99) throw new TokenBoxError('BAD_KEY', `${name}_VERSION must be a whole number from 1 to 99.`);
  return { version, key };
}

function keys(env: NodeJS.ProcessEnv = process.env): { current: Key; all: Key[] } {
  const current = decodeKey(env.CONNECTOR_TOKEN_KEY, env.CONNECTOR_TOKEN_KEY_VERSION, 'CONNECTOR_TOKEN_KEY');
  if (!current) throw new TokenBoxError('NO_KEY', 'Store connections are not configured on this server (CONNECTOR_TOKEN_KEY is missing).');
  const previous = decodeKey(env.CONNECTOR_TOKEN_KEY_PREVIOUS, env.CONNECTOR_TOKEN_KEY_PREVIOUS_VERSION, 'CONNECTOR_TOKEN_KEY_PREVIOUS');
  if (previous && previous.version === current.version) throw new TokenBoxError('BAD_KEY', 'The previous key needs a different version number.');
  return { current, all: previous ? [current, previous] : [current] };
}

/** Is the token box usable on this server? (names only — never reads a value out) */
export function tokenBoxConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try { keys(env); return true; } catch { return false; }
}

/** Seals a secret. `context` (e.g. "<connection id>:access_token") is bound as associated data. */
export function seal(plain: string, context: string, env: NodeJS.ProcessEnv = process.env): { sealed: string; keyVersion: number } {
  if (typeof plain !== 'string' || plain.length === 0 || plain.length > 4096) throw new TokenBoxError('BAD_SEALED', 'Nothing to seal.');
  const { current } = keys(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  cipher.setAAD(Buffer.from(`octopus-connector:${context}`, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { sealed: `v${current.version}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`, keyVersion: current.version };
}

/** Opens a sealed secret (current or previous key). Throws a TokenBoxError without any secret in its message. */
export function open(sealed: string, context: string, env: NodeJS.ProcessEnv = process.env): string {
  const m = SEALED.exec(sealed ?? '');
  if (!m) throw new TokenBoxError('BAD_SEALED', 'The stored credential is not in the expected format.');
  const version = Number(m[1]);
  const key = keys(env).all.find((k) => k.version === version);
  if (!key) throw new TokenBoxError('UNKNOWN_KEY_VERSION', `The stored credential was sealed with key version ${version}, which this server does not have.`);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, Buffer.from(m[2], 'base64url'));
    decipher.setAAD(Buffer.from(`octopus-connector:${context}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(m[3], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(m[4], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new TokenBoxError('OPEN_FAILED', 'The stored credential could not be opened (wrong key or changed data).');
  }
}

/** Needs re-sealing with the current key (rotation)? */
export function needsReseal(sealed: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const m = SEALED.exec(sealed ?? '');
  return !m || Number(m[1]) !== keys(env).current.version;
}

/** For logs: a short, non-reversible fingerprint (never the value). */
export function fingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);
}

/** Removes anything that looks like a token / key / bearer value from a text before it is logged or stored as an error. */
export function redact(text: string): string {
  return String(text ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/(authorization|x-shopify-access-token|access[_-]?token|refresh[_-]?token|api[_-]?key|api[_-]?secret|consumer[_-]?(?:key|secret)|client[_-]?secret|password|sign(?:ature)?)(["'\s:=]+)([^\s"'&,;]+)/gi, '$1$2[redacted]')
    .replace(/\b(shpat|shpca|shppa|shpss|ck|cs)_[A-Za-z0-9]{8,}\b/g, '[redacted]')
    .replace(/\bv[0-9]{1,2}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+/g, '[sealed]');
}
