import 'server-only';

/**
 * Starts a GitHub Actions workflow through `workflow_dispatch` (SPEC §16.2 "Back up now" / restore triggers).
 * Env: GITHUB_REPO ("owner/repo"), GITHUB_ACTIONS_TOKEN (fine-grained PAT, Actions: read & write), GITHUB_DISPATCH_REF (default "main").
 */
export type DispatchResult = { ok: true } | { ok: false; error: 'GITHUB_NOT_CONFIGURED' | 'GITHUB_DISPATCH_FAILED'; status?: number; detail?: string };

export function githubConfigured(env: Record<string, string | undefined> = process.env) {
  return !!(env.GITHUB_REPO?.includes('/') && env.GITHUB_ACTIONS_TOKEN);
}

export async function dispatchWorkflow(file: string, inputs: Record<string, string>, env: Record<string, string | undefined> = process.env): Promise<DispatchResult> {
  if (!githubConfigured(env)) return { ok: false, error: 'GITHUB_NOT_CONFIGURED' };
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(file)}/dispatches`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'octopus-b2b-backups',
      },
      body: JSON.stringify({ ref: env.GITHUB_DISPATCH_REF || 'main', inputs }),
      cache: 'no-store',
    });
    if (res.status === 204 || res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, error: 'GITHUB_DISPATCH_FAILED', status: res.status, detail: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: 'GITHUB_DISPATCH_FAILED', detail: e instanceof Error ? e.message : String(e) };
  }
}
