'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Switch } from '@/components/client';
import { cn } from '@/lib/cn';
import { API_SCOPES, DEFAULT_SCOPES, WEBHOOK_EVENTS } from '@/components/account/dev-constants';
import { createApp, createKey, createWebhook, revealWebhookSecret, setWebhookActive, updateScopes } from '@/app/account/developer/actions';

/* ───────── Copy helpers ───────── */
export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn('btn btn-ghost btn-sm', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — user can still select the text */
        }
      }}
    >
      {done ? 'Copied ✓' : label}
      <span className="sr-only" aria-live="polite">{done ? 'Copied to clipboard' : ''}</span>
    </button>
  );
}

export function CopyField({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="flex items-center gap-2 min-h-11 border border-line bg-surface rounded-[8px] pl-3 pr-1.5 overflow-hidden">
        <code className="mono text-sm font-medium flex-1 min-w-0 truncate">{value}</code>
        {action ?? <CopyButton value={value} />}
      </div>
    </div>
  );
}

/* ───────── Scope checkboxes ───────── */
function ScopeGrid({ value, onChange, disabled, idPrefix }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
      {API_SCOPES.map((sc) => {
        const id = `${idPrefix}-${sc}`;
        const on = value.includes(sc);
        return (
          <label key={sc} htmlFor={id} className={cn('flex items-center gap-2.5 min-h-10 border border-line rounded-[8px] px-3 mono text-[13px] font-medium', disabled ? 'opacity-60' : 'cursor-pointer')}>
            <input
              id={id}
              type="checkbox"
              className="w-[18px] h-[18px] accent-blue"
              checked={on}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, sc] : value.filter((x) => x !== sc))}
            />
            {sc}
          </label>
        );
      })}
    </div>
  );
}

export function ScopesForm({ appId, initial, disabled }: { appId: string; initial: string[]; disabled?: boolean }) {
  const [scopes, setScopes] = useState<string[]>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = [...scopes].sort().join(',') !== [...initial].sort().join(',');
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold mb-2.5">Scopes (what this app can do)</legend>
      <ScopeGrid value={scopes} onChange={(v) => { setScopes(v); setMsg(null); }} disabled={disabled || pending} idPrefix={`sc-${appId}`} />
      {!disabled && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || pending} onClick={() => start(async () => {
            const r = await updateScopes(appId, scopes);
            setMsg(r.ok ? { ok: true, text: 'Scopes saved.' } : { ok: false, text: r.error });
          })}>{pending ? 'Saving…' : 'Save scopes'}</button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} className={cn('text-sm', msg.ok ? 'text-ok' : 'text-bad')}>{msg.text}</span>}
        </div>
      )}
    </fieldset>
  );
}

/* ───────── Create app ───────── */
export function CreateAppForm({ compact }: { compact?: boolean }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className={cn('space-y-4', !compact && 'px-6 pb-6')}
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await createApp({ name, scopes });
          if (!r.ok) setErr(r.error);
          else { setName(''); router.refresh(); }
        });
      }}
    >
      <div>
        <label htmlFor="app-name" className="label">App name</label>
        <input id="app-name" className="input" required minLength={2} maxLength={80} placeholder="e.g. Shopify store sync" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <fieldset>
        <legend className="text-[13px] font-semibold mb-2.5">Scopes (what this app can do)</legend>
        <ScopeGrid value={scopes} onChange={setScopes} disabled={pending} idPrefix="new-app" />
      </fieldset>
      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Creating…' : 'Create app'}</button>
    </form>
  );
}

/* ───────── Create key — secret shown once ───────── */
export function CreateKeyButton({ appId, mode, allowed }: { appId: string; mode: 'test' | 'live'; allowed: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const label = mode === 'live' ? 'Create live secret' : 'Create sandbox secret';
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!allowed || pending}
        onClick={() => {
          setErr(null);
          start(async () => {
            const r = await createKey(appId, mode);
            if (!r.ok) setErr(r.error);
            else if (r.data) { setSecret(r.data.key); router.refresh(); }
          });
        }}
      >
        {pending ? 'Generating…' : label}
      </button>
      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      {secret && (
        <div className="rounded-[10px] border border-warn/40 bg-[#FFF3D6] p-4" role="alert">
          <p className="text-sm font-semibold text-[#8A5A00]">Copy this client secret now — it will not be shown again.</p>
          <p className="text-xs text-[#8A5A00] mt-0.5">We only store a hash. If you lose it, revoke it and create a new one.</p>
          <div className="mt-3 flex items-center gap-2 min-h-11 border border-line bg-white rounded-[8px] pl-3 pr-1.5">
            <code className="mono text-sm font-medium flex-1 min-w-0 break-all py-2" aria-label="New client secret">{secret}</code>
            <CopyButton value={secret} />
          </div>
          <button type="button" className="mt-3 text-sm underline text-[#8A5A00]" onClick={() => setSecret(null)}>I have saved it — hide</button>
        </div>
      )}
    </div>
  );
}

/* ───────── Webhooks ───────── */
export function WebhookForm() {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['order.updated']);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      id="add-webhook"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await createWebhook({ url, events });
          if (!r.ok) setErr(r.error);
          else { setUrl(''); setEvents(['order.updated']); router.refresh(); }
        });
      }}
    >
      <div>
        <label htmlFor="wh-url" className="label">Endpoint URL (https only)</label>
        <input id="wh-url" type="url" inputMode="url" className="input mono" required placeholder="https://example.com/webhooks/octopus" pattern="https://.*" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <fieldset>
        <legend className="text-[13px] font-semibold mb-2.5">Events</legend>
        <div className="flex flex-wrap gap-2.5">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} htmlFor={`wh-ev-${ev}`} className="flex items-center gap-2.5 min-h-10 border border-line rounded-[8px] px-3 mono text-[13px] font-medium cursor-pointer">
              <input id={`wh-ev-${ev}`} type="checkbox" className="w-[18px] h-[18px] accent-blue" checked={events.includes(ev)}
                onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
              {ev}
            </label>
          ))}
        </div>
      </fieldset>
      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Adding…' : 'Add webhook'}</button>
    </form>
  );
}

export function WebhookSecret({ id, hint }: { id: string; hint: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="mono text-[13px] break-all">{secret ?? `••••••••••••${hint}`}</code>
      {secret ? (
        <>
          <CopyButton value={secret} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>Hide</button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => {
          const r = await revealWebhookSecret(id);
          if (r.ok && r.data) setSecret(r.data.secret); else if (!r.ok) setErr(r.error);
        })}>{pending ? '…' : 'Reveal'}</button>
      )}
      {err && <span className="text-xs text-bad" role="alert">{err}</span>}
    </span>
  );
}

export function WebhookToggle({ id, active, url }: { id: string; active: boolean; url: string }) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Switch checked={on} disabled={pending} label={`Webhook ${url} active`} onChange={(v) => {
        setOn(v);
        setErr(null);
        start(async () => {
          const r = await setWebhookActive(id, v);
          if (!r.ok) { setOn(!v); setErr(r.error); }
        });
      }} />
      <span className="text-sm">{on ? 'Active' : 'Paused'}</span>
      {err && <span className="text-xs text-bad" role="alert">{err}</span>}
    </span>
  );
}
