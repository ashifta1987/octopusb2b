import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { open, seal } from '@/lib/crypto/token-box';

/**
 * C0 · store_credentials access (SERVICE ROLE ONLY). Only server code that runs a connector may call these; nothing here is ever
 * returned to the browser. The database row holds the sealed text + key_version; audit rows (trigger) keep the kind and version, never
 * the value. Errors never contain the secret.
 */
export type CredentialKind = 'access_token' | 'refresh_token' | 'api_key' | 'api_secret' | 'consumer_key' | 'consumer_secret' | 'webhook_secret';
const context = (connectionId: string, kind: CredentialKind) => `${connectionId}:${kind}`;

export async function saveCredential(connectionId: string, kind: CredentialKind, plain: string, expiresAt: Date | null = null): Promise<void> {
  const { sealed, keyVersion } = seal(plain, context(connectionId, kind));
  const sb = createAdminClient();
  const { error } = await sb.from('store_credentials').upsert(
    { connection_id: connectionId, kind, ciphertext: sealed, key_version: keyVersion, expires_at: expiresAt?.toISOString() ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'connection_id,kind' },
  );
  if (error) throw new Error(`The ${kind.replace('_', ' ')} could not be saved.`);
}

export async function readCredential(connectionId: string, kind: CredentialKind): Promise<{ value: string; expiresAt: string | null } | null> {
  const sb = createAdminClient();
  const { data, error } = await sb.from('store_credentials').select('ciphertext, expires_at').eq('connection_id', connectionId).eq('kind', kind).maybeSingle();
  if (error) throw new Error(`The ${kind.replace('_', ' ')} could not be read.`);
  if (!data) return null;
  return { value: open(String(data.ciphertext), context(connectionId, kind)), expiresAt: (data.expires_at as string | null) ?? null };
}

export async function deleteCredentials(connectionId: string): Promise<void> {
  const sb = createAdminClient();
  const { error } = await sb.from('store_credentials').delete().eq('connection_id', connectionId);
  if (error) throw new Error('The store credentials could not be deleted.');
}
