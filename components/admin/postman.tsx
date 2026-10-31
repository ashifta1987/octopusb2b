'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Sync now" for the Postman card (SPEC §15.2). POSTs to /api/postman/sync, which pushes the OpenAPI
 * definition + collections with POSTMAN_API_KEY server-side. Handles a missing route (404/501) gracefully.
 */
export function PostmanSyncButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={disabled || pending}
        onClick={() => {
          if (!window.confirm('Push the OpenAPI definition and both collections to the Postman workspace now?')) return;
          setMsg(null);
          start(async () => {
            try {
              const res = await fetch('/api/postman/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
              if (res.status === 404 || res.status === 501) {
                setMsg({ ok: false, text: 'Sync is not available yet — the sync endpoint has not been deployed. CI still syncs on every release.' });
                return;
              }
              let body: { ok?: boolean; message?: string; error?: string } = {};
              try { body = await res.json(); } catch { /* non-JSON response */ }
              if (!res.ok || body.ok === false) {
                setMsg({ ok: false, text: body.error ?? body.message ?? `Sync failed (HTTP ${res.status}).` });
              } else {
                setMsg({ ok: true, text: body.message ?? 'Sync started.' });
              }
              router.refresh();
            } catch (e) {
              setMsg({ ok: false, text: `Sync failed: ${(e as Error).message}` });
            }
          });
        }}
      >
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
      {msg && <span role={msg.ok ? 'status' : 'alert'} className={`text-xs mt-1 max-w-[260px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</span>}
    </span>
  );
}
