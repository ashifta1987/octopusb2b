'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { errorCode, errorText, EXPORT_GROUPS, PARTIAL_MODULES } from './shared';
import { requestRestore, approveRestore, cancelRestore, sendApproverReminder, requestExport, setMaintenanceMode } from '@/app/admin/backups/actions';

type ApiResult = { ok: boolean; error?: string; [k: string]: unknown };

/** Calls one of the §16 HTTP routes; a missing route (404) or non-JSON answer becomes NOT_AVAILABLE instead of crashing. */
export async function callApi(url: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { ok: false, error: res.status === 404 ? 'NOT_AVAILABLE' : `HTTP ${res.status}` };
    const j = (await res.json()) as ApiResult;
    if (!res.ok && j.ok !== false) return { ok: false, error: `HTTP ${res.status}` };
    return j;
  } catch {
    return { ok: false, error: 'Network error — please try again.' };
  }
}

/** SPEC §17.3 step-up: re-enter the 2FA code at /staff/verify, then come back to `next`. */
function mfaUrl(next: string) {
  return stepUpRedirect(next);
}

const needsCode = (code: string | undefined) => code === 'MFA_REQUIRED' || code === 'STEP_UP_REQUIRED';

function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="text-sm text-bad mt-2">{error}</p>;
  if (ok) return <p role="status" className="text-sm text-ok font-semibold mt-2">✓ {ok}</p>;
  return null;
}

/* ───────── Back up now + progress ───────── */

const BACKUP_EVENT = 'octo:backup-started';
type StartedDetail = { id: string; code?: string; notConfigured?: boolean };

export function BackupNowButton({ allowed }: { allowed: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button" className="btn btn-primary" disabled={!allowed || pending}
        title={allowed ? undefined : 'You need the "back up" permission'}
        onClick={() => {
          const note = window.prompt('Back up now — optional note (e.g. "Before publishing new Terms")', '');
          if (note == null) return;
          setErr(null);
          start(async () => {
            const r = await callApi('/api/backups/trigger', 'POST', { note: note.trim() || undefined });
            const id = (r.backup_id ?? r.id) as string | undefined;
            if (r.ok || (r.error === 'GITHUB_NOT_CONFIGURED' && id)) {
              if (id) window.dispatchEvent(new CustomEvent<StartedDetail>(BACKUP_EVENT, { detail: { id, code: r.code as string | undefined, notConfigured: r.error === 'GITHUB_NOT_CONFIGURED' } }));
              router.refresh();
            } else setErr(errorText(r.error));
          });
        }}
      >
        {pending ? 'Starting…' : 'Back up now'}
      </button>
      {err && <span role="alert" className="text-xs text-bad mt-1 max-w-[260px] text-right">{err}</span>}
    </span>
  );
}

type Live = { id: string; code: string; status: string; progress: number; error?: string | null };

/** Progress bar for the running backup — polls the backups row every 3 s (RLS: backups:view). */
export function BackupProgress({ initial, githubConfigured }: { initial: Live | null; githubConfigured?: boolean }) {
  const [row, setRow] = useState<Live | null>(initial);
  const [notConfigured, setNotConfigured] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<StartedDetail>).detail;
      setRow({ id: d.id, code: d.code ?? 'New backup', status: 'queued', progress: 0 });
      setNotConfigured(!!d.notConfigured);
    };
    window.addEventListener(BACKUP_EVENT, onStart);
    return () => window.removeEventListener(BACKUP_EVENT, onStart);
  }, []);

  const id = row?.id;
  const active = row && (row.status === 'queued' || row.status === 'running');
  useEffect(() => {
    if (!id || !active) return;
    const sb = createClient();
    const t = setInterval(async () => {
      const { data } = await sb.from('backups').select('id, code, status, progress, error').eq('id', id).maybeSingle();
      if (!data) return;
      setRow(data as Live);
      if (data.status === 'completed' || data.status === 'failed') router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [id, active, router]);

  if (!row) return null;
  const done = row.status === 'completed';
  const failed = row.status === 'failed';
  if (!active && !done && !failed) return null;
  const pct = done ? 100 : Math.max(row.status === 'running' ? 3 : 0, row.progress);
  return (
    <section className="card p-5 mb-6" aria-live="polite">
      <div className="flex flex-wrap justify-between gap-2 text-[15px]">
        <span className="font-semibold">
          <span className="mono">{row.code}</span> · {done ? 'Backup completed' : failed ? 'Backup failed' : row.status === 'queued' ? 'Queued — waiting for the backup workflow to start' : 'Backing up database and file buckets…'}
        </span>
        <span className="mono text-sm">{pct}%</span>
      </div>
      <div className="mt-2 h-2.5 rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Backup progress">
        <div className={cn('h-2.5 rounded-full transition-all', failed ? 'bg-bad' : done ? 'bg-ok' : 'bg-blue')} style={{ width: `${pct}%` }} />
      </div>
      {failed && row.error && <p className="text-sm text-bad mt-2">{row.error}</p>}
      {(notConfigured || (row.status === 'queued' && githubConfigured === false)) && (
        <div role="status" className="mt-4 rounded-[10px] border border-warn/40 bg-[#FFF3D6] px-4 py-3 text-sm text-[#8A5A00]">
          <b>Backup workflow not connected yet.</b> The backup was saved as <i>queued</i>, but GitHub Actions could not be started.
          To finish setup (see <span className="mono">docs/BACKUP-SETUP.md</span>): add the <span className="mono">backup.yml</span> workflow to the repository,
          set <span className="mono">GITHUB_REPO</span> and <span className="mono">GITHUB_ACTIONS_TOKEN</span> (workflow scope) in the Vercel environment, add the off-site
          bucket keys (<span className="mono">BACKUP_S3_*</span>), the age public key and <span className="mono">BACKUP_CALLBACK_SECRET</span> as GitHub secrets. The nightly
          schedule then runs automatically and this bar fills in as the workflow reports back.
        </div>
      )}
    </section>
  );
}

/* ───────── Table filter + download ───────── */

export function FilterSelect({ value, options, param = 'filter', label }: { value: string; options: { value: string; label: string }[]; param?: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <>
      <label htmlFor={`f-${param}`} className="sr-only">{label}</label>
      <select
        id={`f-${param}`} className="input !w-auto min-w-[160px]" value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          q.set(param, e.target.value);
          router.push(`${pathname}?${q.toString()}`, { scroll: false });
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  );
}

/** Download: 2FA re-check + 10-minute presigned link (GET /api/backups/[id]/download). */
export function DownloadBackupButton({ id, disabled }: { id: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button" className="btn btn-ghost btn-sm" disabled={disabled || pending}
        onClick={() => start(async () => {
          setErr(null);
          const r = await callApi(`/api/backups/${id}/download`, 'GET');
          if (r.ok && typeof r.url === 'string') { window.open(r.url, '_blank', 'noopener'); return; }
          if (needsCode(errorCode(r.error))) { router.push(mfaUrl('/admin/backups')); return; }
          setErr(errorText(r.error));
        })}
      >
        {pending ? '…' : 'Download'}
      </button>
      {err && <span role="alert" className="text-xs text-bad mt-1 max-w-[200px] whitespace-normal">{err}</span>}
    </span>
  );
}

/** Re-renders the server page every few seconds while a workflow is running. */
export function AutoRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [every, router]);
  return null;
}

/* ───────── Restore wizard ───────── */

const TYPES: { value: string; title: string; body: string }[] = [
  { value: 'full_staging', title: 'Full restore to staging', body: 'Rebuild the test site from this backup. Safe: live customers are not affected.' },
  { value: 'full_production', title: 'Full restore to live site', body: 'Replaces all live data. The site goes into maintenance mode, then comes back with this backup. Orders placed after the backup time must be re-entered.' },
  { value: 'partial', title: 'Restore selected records', body: 'Bring back deleted or damaged products, customers, orders or pages without touching anything else.' },
];

export function TypeOption({ value, title, body, checked, disabled, onChange, name = 'restore_type' }: { value: string; title: string; body: string; checked: boolean; disabled?: boolean; onChange?: () => void; name?: string }) {
  return (
    <label className={cn('flex gap-3 rounded-xl border p-4 cursor-pointer', checked ? 'border-blue border-2 bg-blue-soft/40' : 'border-line', disabled && 'cursor-default')}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 w-[18px] h-[18px] accent-[#2A6FD6] flex-none" />
      <span>
        <span className="block font-semibold text-[16px]">{title}</span>
        <span className="block text-sm text-muted mt-0.5">{body}</span>
      </span>
    </label>
  );
}

export function RestoreForm({ backupId, backupCode, initialType, canRequest }: { backupId: string; backupCode: string; initialType: string; canRequest: boolean }) {
  const [type, setType] = useState(initialType);
  const [reason, setReason] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [records, setRecords] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const options = initialType === 'drill'
    ? [{ value: 'drill', title: 'Verify only (restore drill)', body: 'Restore this backup into a scratch project and run every check. Nothing else changes.' }, ...TYPES]
    : TYPES;

  const submit = () => {
    setErr(null);
    if (!reason.trim()) { setErr(errorText('REASON_REQUIRED')); return; }
    if (type === 'partial' && !modules.length) { setErr(errorText('MODULES_REQUIRED')); return; }
    if (type === 'full_production' && !window.confirm(`Request a FULL RESTORE OF THE LIVE SITE from ${backupCode}?\n\nAfter verification and a second approval, the site goes into maintenance mode and all live data is replaced. Orders placed after the backup time must be re-entered.`)) return;
    const ids = records.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    const rec: Record<string, string[]> = {};
    if (type === 'partial' && ids.length) modules.forEach((m) => (rec[m] = ids));
    start(async () => {
      const r = await requestRestore({ backupId, type, reason, modules, records: rec });
      if (!r.ok) {
        if (needsCode(r.code)) { router.push(mfaUrl(`/admin/backups?backup=${backupId}&type=${type}#restore`)); return; }
        setErr(r.error); return;
      }
      const v = await callApi(`/api/backups/restore/${r.id}/verify`);
      if (!v.ok) setErr(`Request saved. Verification could not be started: ${errorText(v.error)}`);
      router.push(`/admin/backups?rs=${r.id}#restore`, { scroll: false });
      router.refresh();
    });
  };

  return (
    <div>
      <fieldset disabled={!canRequest || pending}>
        <legend className="font-semibold mb-3">What to restore</legend>
        <div className="space-y-3">
          {options.map((o) => <TypeOption key={o.value} {...o} checked={type === o.value} onChange={() => setType(o.value)} />)}
        </div>
        {type === 'partial' && (
          <div className="mt-4 rounded-xl border border-line p-4">
            <p className="text-sm font-semibold mb-2">Modules</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {PARTIAL_MODULES.map((m) => (
                <label key={m.key} className="flex gap-2 items-start text-sm">
                  <input type="checkbox" className="mt-0.5 w-[18px] h-[18px] accent-[#2A6FD6]" checked={modules.includes(m.key)}
                    onChange={(e) => setModules((cur) => (e.target.checked ? [...cur, m.key] : cur.filter((x) => x !== m.key)))} />
                  {m.label}
                </label>
              ))}
            </div>
            <label htmlFor="rs-records" className="label mt-4">Record IDs (optional — leave empty to compare the whole module)</label>
            <textarea id="rs-records" className="input min-h-[72px] mono text-xs" placeholder="Paste record UUIDs separated by commas or new lines" value={records} onChange={(e) => setRecords(e.target.value)} />
            <p className="text-xs text-muted mt-1">After verification you pick the exact rows on the <a className="text-blue font-semibold" href="/admin/backups/recovery">compare screen</a>. Money records are never overwritten.</p>
          </div>
        )}
        <label htmlFor="rs-reason" className="label mt-4">Reason (shown to approver and in audit log)</label>
        <input id="rs-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rebuild staging for the November release test" maxLength={500} />
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-dark" disabled={!canRequest || pending} onClick={submit}>{pending ? 'Starting…' : 'Create request & verify'}</button>
        <a href="/admin/backups#backups" className="btn btn-ghost">Choose another backup</a>
      </div>
      {!canRequest && <p className="text-sm text-muted mt-2">You need the “request restore” permission.</p>}
      <Msg error={err} />
    </div>
  );
}

export function RestoreActions({ id, status, canApprove, isRequester, canCancel, canRemind, approveBlockedReason }: {
  id: string; status: string; canApprove: boolean; isRequester: boolean; canCancel: boolean; canRemind: boolean; approveBlockedReason?: string | null;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOk] = useState<string | null>(null);
  const router = useRouter();
  const open = !['running', 'completed', 'failed', 'cancelled'].includes(status);
  const approvable = status === 'pending_approval' && canApprove && !isRequester && !approveBlockedReason;
  const run = () => start(async () => {
    const r = await callApi(`/api/backups/restore/${id}/run`);
    if (!r.ok) { setErr(`Approved. The run could not be started: ${errorText(r.error)}`); router.refresh(); return; }
    setOk('Restore started'); router.refresh();
  });
  return (
    <div>
      <div className="flex flex-wrap justify-end gap-3">
        {open && canCancel && (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => {
            const reason = window.prompt('Cancel this restore request? Optional reason:', '');
            if (reason == null) return;
            setErr(null); setOk(null);
            start(async () => { const r = await cancelRestore(id, reason); if (r.ok) { setOk(r.message ?? 'Cancelled'); router.refresh(); } else setErr(r.error); });
          }}>Cancel request</button>
        )}
        {status === 'pending_approval' && canRemind && (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(async () => {
            setErr(null); setOk(null);
            const r = await sendApproverReminder(id);
            if (r.ok) setOk(r.message ?? 'Reminder sent'); else setErr(r.error);
          })}>Send reminder to approver</button>
        )}
        {status === 'approved' && (canApprove || isRequester) && (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => { if (window.confirm('Start the approved restore now?')) run(); }}>Run now</button>
        )}
        {open && status !== 'approved' && (
          <button
            type="button" className="btn btn-primary" disabled={!approvable || pending}
            title={isRequester ? 'The requester cannot approve (maker–checker)' : approveBlockedReason ?? (status !== 'pending_approval' ? 'Available after verification passes' : undefined)}
            onClick={() => {
              if (!window.confirm('Approve and run this restore? You will be asked for 2FA if your session is not verified.')) return;
              setErr(null); setOk(null);
              start(async () => {
                const r = await approveRestore(id);
                if (!r.ok) {
                  if (needsCode(r.code)) { router.push(mfaUrl(`/admin/backups?rs=${id}#restore`)); return; }
                  setErr(r.error); return;
                }
                run();
              });
            }}
          >{pending ? 'Working…' : 'Approve & run'}</button>
        )}
      </div>
      <div className="text-right"><Msg error={err} ok={okMsg} /></div>
    </div>
  );
}

/* ───────── Data exports ───────── */

export function ExportForm({ defaultFrom, defaultTo, allowed }: { defaultFrom: string; defaultTo: string; allowed: boolean }) {
  const [groups, setGroups] = useState<string[]>(EXPORT_GROUPS.filter((g) => g.checked).map((g) => g.key));
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [format, setFormat] = useState('xlsx');
  const [email, setEmail] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null); setOk(null);
        const chosen = EXPORT_GROUPS.filter((g) => groups.includes(g.key));
        const modules = chosen.flatMap((g) => g.modules);
        if (!modules.length) { setErr(errorText('MODULES_REQUIRED')); return; }
        start(async () => {
          const r = await requestExport({ modules, format, from, to, email, title: chosen.map((g) => g.label).join(', ') });
          if (!r.ok) { setErr(r.error); return; }
          const run = await callApi(`/api/exports/${r.id}/run`);
          if (run.ok) setOk(run.status === 'ready' ? 'Export ready — download it below' : 'Export queued — it appears below when ready');
          else setOk(`Export queued. It will be built by the worker (${errorText(run.error)}).`);
          router.refresh();
        });
      }}
    >
      <fieldset disabled={!allowed || pending}>
        <legend className="sr-only">Modules</legend>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {EXPORT_GROUPS.map((g) => (
            <label key={g.key} className="flex gap-2.5 items-start text-sm text-[#3B4556]">
              <input type="checkbox" className="mt-0.5 w-[18px] h-[18px] accent-[#2A6FD6] flex-none" checked={groups.includes(g.key)}
                onChange={(e) => setGroups((cur) => (e.target.checked ? [...cur, g.key] : cur.filter((x) => x !== g.key)))} />
              {g.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div><label className="label" htmlFor="ex-from">From</label><input id="ex-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="ex-to">To</label><input id="ex-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <label className="label" htmlFor="ex-format">Format</label>
            <select id="ex-format" className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xlsx">Excel</option><option value="csv">CSV</option><option value="json">JSON</option>
            </select>
          </div>
        </div>
        <label className="flex gap-2.5 items-center text-sm mt-4">
          <input type="checkbox" className="w-[18px] h-[18px] accent-[#2A6FD6]" checked={email} onChange={(e) => setEmail(e.target.checked)} />
          Email me the download link
        </label>
        <button type="submit" className="btn btn-dark mt-4">{pending ? 'Creating…' : 'Create export'}</button>
      </fieldset>
      {!allowed && <p className="text-sm text-muted mt-2">You need the “export” permission.</p>}
      <Msg error={err} ok={okMsg} />
    </form>
  );
}

export function ExportDownload({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (status === 'queued' || status === 'failed') {
    return (
      <span className="inline-flex flex-col items-end">
        <button type="button" className="text-blue font-semibold text-sm" disabled={pending} onClick={() => start(async () => {
          setErr(null);
          const r = await callApi(`/api/exports/${id}/run`);
          if (!r.ok) setErr(errorText(r.error));
          router.refresh();
        })}>{pending ? 'Building…' : status === 'failed' ? 'Retry' : 'Build now'}</button>
        {err && <span role="alert" className="text-xs text-bad max-w-[200px] text-right">{err}</span>}
      </span>
    );
  }
  if (status !== 'ready') return <span className="text-sm text-muted">{status === 'running' ? 'Building…' : 'Expired'}</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="text-blue font-semibold text-sm" disabled={pending} onClick={() => start(async () => {
        setErr(null);
        const r = await callApi(`/api/exports/${id}/download`, 'GET');
        const urls = Array.isArray(r.urls) ? (r.urls as string[]) : typeof r.url === 'string' ? [r.url] : [];
        if (r.ok && urls.length) urls.forEach((u) => window.open(u, '_blank', 'noopener'));
        else setErr(errorText(r.error ?? 'NOT_AVAILABLE'));
      })}>{pending ? '…' : 'Download'}</button>
      {err && <span role="alert" className="text-xs text-bad max-w-[200px] text-right">{err}</span>}
    </span>
  );
}

/* ───────── Settings helpers ───────── */

export function OffsiteTestButton({ allowed }: { allowed: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={!allowed || pending} onClick={() => start(async () => {
        const r = await callApi('/api/backups/offsite/test');
        setMsg(r.ok ? { ok: true, text: 'Connected' } : { ok: false, text: errorText(r.error) });
        router.refresh();
      })}>{pending ? 'Testing…' : 'Test'}</button>
      {msg && <span role={msg.ok ? 'status' : 'alert'} className={cn('text-xs mt-1 max-w-[220px]', msg.ok ? 'text-ok' : 'text-bad')}>{msg.text}</span>}
    </span>
  );
}

export function MaintenanceControl({ enabled, message, retryAfter, allowed }: { enabled: boolean; message: string; retryAfter: number; allowed: boolean }) {
  const [msg, setMsg] = useState(message);
  const [retry, setRetry] = useState(String(Math.round(retryAfter / 60)));
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (on: boolean) => {
    const q = on
      ? 'Turn ON maintenance mode?\n\nThe storefront and portals show the notice, the public API returns 503 and queues pause. The admin portal keeps working.'
      : 'Turn OFF maintenance mode? The site goes back to normal.';
    if (!window.confirm(q)) return;
    setErr(null); setOk(null);
    start(async () => {
      const r = await setMaintenanceMode(on, msg, Number(retry) * 60);
      if (r.ok) { setOk(r.message ?? 'Saved'); router.refresh(); } else setErr(r.error);
    });
  };
  return (
    <div>
      <fieldset disabled={!allowed || pending}>
        <label htmlFor="mm-msg" className="label">Notice shown to visitors</label>
        <textarea id="mm-msg" className="input min-h-[72px]" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} />
        <label htmlFor="mm-retry" className="label mt-3">Expected duration (minutes, sent as Retry-After)</label>
        <input id="mm-retry" type="number" min={1} max={1440} className="input !w-32" value={retry} onChange={(e) => setRetry(e.target.value)} />
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          {enabled
            ? <button type="button" className="btn btn-primary" onClick={() => go(false)}>Turn maintenance OFF</button>
            : <button type="button" className="btn btn-danger" onClick={() => go(true)}>Turn maintenance ON</button>}
          {enabled && <button type="button" className="btn btn-ghost" onClick={() => go(true)}>Update notice</button>}
        </div>
      </fieldset>
      {!allowed && <p className="text-sm text-muted mt-2">Only an Admin can change maintenance mode.</p>}
      <Msg error={err} ok={okMsg} />
    </div>
  );
}
