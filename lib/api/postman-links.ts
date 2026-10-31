/**
 * Links for the "Run in Postman" button, the public workspace and the download fallback (SPEC §15.2) — used by
 * /account/developer. Safe on server and client (only NEXT_PUBLIC_* env).
 *
 *  NEXT_PUBLIC_POSTMAN_WORKSPACE_URL     e.g. https://www.postman.com/octopusb2b/octopus-b2b-api
 *  NEXT_PUBLIC_POSTMAN_COLLECTION_UID    public collection uid (<owner id>-<collection id>) from the Postman sync output
 *  NEXT_PUBLIC_POSTMAN_ENVIRONMENT_UID   optional sandbox environment uid (forked together with the collection)
 */
const env = (v: string | undefined) => (v ?? '').trim() || null;

export const POSTMAN_WORKSPACE_URL = env(process.env.NEXT_PUBLIC_POSTMAN_WORKSPACE_URL);
export const POSTMAN_COLLECTION_UID = env(process.env.NEXT_PUBLIC_POSTMAN_COLLECTION_UID);
export const POSTMAN_ENVIRONMENT_UID = env(process.env.NEXT_PUBLIC_POSTMAN_ENVIRONMENT_UID);
/** NEXT_PUBLIC_POSTMAN_WORKSPACE_ID — workspace id the fork link points at (optional). */
export const POSTMAN_WORKSPACE_ID = env(process.env.NEXT_PUBLIC_POSTMAN_WORKSPACE_ID);

/** Download fallback (served by this deployment, generated from the same source as the workspace). */
export const POSTMAN_DOWNLOADS = {
  publicCollection: '/api/v1/postman.json',
  supplierCollection: '/api/v1/postman/supplier.json',
  sandboxEnvironment: '/api/v1/postman/environment/sandbox.json',
  liveEnvironment: '/api/v1/postman/environment/live.json',
  openapi: '/api/v1/openapi.json',
} as const;

/** "Run in Postman" fork link, or null when the collection uid is not configured yet (show the downloads instead). */
export function runInPostmanUrl(uid = POSTMAN_COLLECTION_UID, environmentUid = POSTMAN_ENVIRONMENT_UID, workspaceId = POSTMAN_WORKSPACE_ID) {
  if (!uid) return null;
  const ws = workspaceId ? `&workspaceId=${workspaceId}` : '';
  const u = new URL(`https://god.gw.postman.com/run-collection/${encodeURIComponent(uid)}`);
  u.searchParams.set('action', 'collection/fork');
  u.searchParams.set('source', 'rip_markdown');
  u.searchParams.set('collection-url', `entityId=${uid}&entityType=collection${ws}`);
  if (environmentUid) u.searchParams.set('environment-url', `entityId=${environmentUid}&entityType=environment${ws}`);
  return u.toString();
}

/** Official Postman button image. */
export const RUN_IN_POSTMAN_BADGE = 'https://run.pstmn.io/button.svg';
