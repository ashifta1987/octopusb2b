'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsNotice, DsSelect } from '@/components/dropship-ui';
import { COUNTRY_NAMES, fmtDate, money } from '@/lib/format';
import {
  approveCustomsPolicyAction,
  confirmDutyEntryAction,
  createDutyDraftAction,
  deleteDutyEntryAction,
  proposeCustomsPolicyAction,
  publishDutyVersionAction,
  rejectCustomsPolicyAction,
  rejectDutyVersionAction,
  saveDutyEntryAction,
  submitDutyVersionAction,
} from './actions';

export type DutyVersion = {
  id: string; version: number; status: string; note: string | null; effective_from: string | null;
  created_by: string | null; created_by_name: string | null; submitted_by: string | null; submitted_by_name: string | null;
  submitted_at: string | null; activated_by_name: string | null; created_at: string; entries: number; confirmed: number;
};
export type DutyEntry = {
  id: string; version_id: string; country: string; hs_prefix: string | null; duty_bp: number | null; tax_bp: number | null;
  de_minimis_cents: number; de_minimis_applies_to: string; source: string | null; status: string; edited_by: string | null;
};
export type CustomsPolicy = {
  id: string; version: number; block_below_pct: number | null; shipping_in_declared_value: string; status: string; note: string | null;
  proposed_by: string; proposed_by_name: string | null; approved_by_name: string | null; effective_from: string | null;
  reject_reason: string | null; created_at: string;
};
export type DataCompleteness = { published: number; hs_verified: number; weight_and_box: number } | null;
export type DutyAccess = { userId: string; canEdit: boolean; canPublish: boolean; readOnly: boolean };

type Msg = { ok: boolean; text: string } | null;
type Result = { ok: boolean; message?: string; error?: string };

const ENTRY_TONE: Record<string, 'ok' | 'warn' | 'bad'> = { confirmed: 'ok', verify: 'warn', needs_data: 'bad' };
const ENTRY_LABEL: Record<string, string> = { confirmed: 'Confirmed', verify: 'Verify', needs_data: 'Needs data' };
const SHIPPING_RULE: Record<string, string> = {
  follow_destination: 'Follow the destination rule', include: 'Always include shipping', exclude: 'Never include shipping',
};
const pct = (bp: number | null) => (bp == null ? 'Not known yet' : `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`);
const toPct = (bp: number | null) => (bp == null ? '' : String(bp / 100));
const keyOf = (e: { country: string; hs_prefix: string | null }) => `${e.country}|${e.hs_prefix ?? ''}`;
const sameData = (a: DutyEntry, b: DutyEntry) =>
  a.duty_bp === b.duty_bp && a.tax_bp === b.tax_bp && Number(a.de_minimis_cents) === Number(b.de_minimis_cents)
  && a.de_minimis_applies_to === b.de_minimis_applies_to && (a.source ?? '') === (b.source ?? '');
const sourceLink = (s: string | null) =>
  !s ? <span className="text-muted">—</span> : /^https?:\/\//i.test(s)
    ? <a href={s} target="_blank" rel="noopener noreferrer nofollow" className="underline break-all text-coral-text">{s.replace(/^https?:\/\//, '').slice(0, 40)}</a>
    : <span>{s}</span>;

function Message({ m }: { m: Msg }) {
  if (!m) return null;
  return <p role={m.ok ? 'status' : 'alert'} data-testid="compliance-msg" className={`m-0 text-[13px] ${m.ok ? 'text-ok' : 'text-bad'}`}>{m.text}</p>;
}

/** A small inline "reason" form used for reject / send back (keyboard friendly, no browser prompt). */
function ReasonForm({ label, button, onSubmit, onCancel, pending }: {
  label: string; button: string; onSubmit: (reason: string) => void; onCancel: () => void; pending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <form className="flex flex-wrap gap-2 items-end" action={() => onSubmit(reason)}>
      <DsInput label={label} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
      <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>{button}</DsButton>
      <DsButton variant="link" onClick={onCancel}>Cancel</DsButton>
    </form>
  );
}

/* ───────── Edit entry ───────── */
function EntryForm({ versionId, entry, onDone, pending, run }: {
  versionId: string; entry: DutyEntry | null; onDone: () => void; pending: boolean; run: (p: () => Promise<Result>, after?: () => void) => void;
}) {
  return (
    // onSubmit (not a form action) so the typed values stay in the form when the database refuses the save
    <form className="flex flex-col gap-3" data-testid="duty-entry-form" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      run(() => saveDutyEntryAction(fd), onDone);
    }}>
      <input type="hidden" name="version_id" value={versionId} />
      <DsInput label="Country (2-letter code)" name="country" required maxLength={2} defaultValue={entry?.country ?? ''} readOnly={Boolean(entry)} />
      <DsInput label="HS prefix" name="hs_prefix" inputMode="numeric" hint="2 to 10 digits. Empty = country default" defaultValue={entry?.hs_prefix ?? ''} readOnly={Boolean(entry)} />
      <div className="grid grid-cols-2 gap-3">
        <DsInput label="Duty %" name="duty_pct" inputMode="decimal" hint="Empty = not known yet" defaultValue={toPct(entry?.duty_bp ?? null)} />
        <DsInput label="Import tax %" name="tax_pct" inputMode="decimal" hint="Empty = not known yet" defaultValue={toPct(entry?.tax_bp ?? null)} />
      </div>
      <DsInput label="De minimis amount (US$)" name="de_minimis" inputMode="decimal" hint="United States: none (0). Never pre-filled."
        defaultValue={entry && Number(entry.de_minimis_cents) ? (Number(entry.de_minimis_cents) / 100).toFixed(2) : ''} />
      <DsSelect label="Applies to" name="applies_to" defaultValue={entry?.de_minimis_applies_to ?? 'duty'}>
        <option value="duty">Duty only</option><option value="duty_and_tax">Duty and tax</option>
      </DsSelect>
      <DsInput label="Source link" name="source" placeholder="https://…" defaultValue={entry?.source ?? ''} />
      <DsSelect label="Status" name="status" defaultValue={entry?.status === 'confirmed' ? 'verify' : entry?.status ?? 'needs_data'}
        hint="Confirmed needs a second person who checked the source.">
        <option value="needs_data">Needs data</option><option value="verify">Verify</option><option value="confirmed">Confirmed</option>
      </DsSelect>
      <div className="flex gap-2">
        <DsButton type="submit" disabled={pending} testId="duty-entry-save">Save entry</DsButton>
        <DsButton variant="secondary" onClick={onDone}>Cancel</DsButton>
      </div>
    </form>
  );
}

export function ComplianceClient({ versions, entries, policies, completeness, access }: {
  versions: DutyVersion[]; entries: DutyEntry[]; policies: CustomsPolicy[]; completeness: DataCompleteness; access: DutyAccess;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<DutyEntry | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const run = (p: () => Promise<Result>, after?: () => void) => start(async () => {
    const r = await p();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(); router.refresh(); }
  });

  const active = versions.find((v) => v.status === 'active') ?? null;
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  const shown = draft ?? active;
  const activeEntries = useMemo(() => entries.filter((e) => e.version_id === active?.id), [entries, active]);
  const shownEntries = useMemo(() => entries.filter((e) => e.version_id === shown?.id), [entries, shown]);
  const diff = useMemo(() => {
    if (!draft || !active) return null;
    const base = new Map(activeEntries.map((e) => [keyOf(e), e]));
    const mark = new Map<string, 'new' | 'changed'>();
    for (const e of shownEntries) {
      const b = base.get(keyOf(e));
      if (!b) mark.set(e.id, 'new'); else if (!sameData(b, e)) mark.set(e.id, 'changed');
    }
    const removed = activeEntries.filter((b) => !shownEntries.some((e) => keyOf(e) === keyOf(b))).length;
    return { mark, changed: [...mark.values()].filter((v) => v === 'changed').length, added: [...mark.values()].filter((v) => v === 'new').length, removed };
  }, [draft, active, activeEntries, shownEntries]);
  const preparedByMe = Boolean(draft && (draft.submitted_by === access.userId || draft.created_by === access.userId));
  const openEntries = shownEntries.filter((e) => e.status !== 'confirmed').length;

  const activePolicy = policies.find((p) => p.status === 'active') ?? null;
  const pendingPolicy = policies.find((p) => p.status === 'pending_approval') ?? null;
  const share = (a: number) => (completeness && completeness.published > 0 ? `${Math.round((a / completeness.published) * 100)}%` : '—');

  return (
    <div className="flex flex-col gap-5">
      {access.readOnly && <DsNotice tone="info" title="Read only">You can see the duty and tax rules and their history. Dropship, Finance and admins make changes.</DsNotice>}

      {access.canEdit && !draft && (
        <div className="flex flex-wrap gap-2">
          <DsButton icon="plus" disabled={pending} testId="duty-new-version" onClick={() => run(() => createDutyDraftAction(active?.id ?? null))}>
            New version of the rate table
          </DsButton>
        </div>
      )}

      <DsNotice tone="info" title="Most specific match wins.">
        A product with HS code 8516.79 uses the 8516 entry for that country if there is one, otherwise the country default (blank HS prefix). No entry = duties “not known yet”, and DDP products can’t be published.
      </DsNotice>

      <div className={`grid grid-cols-1 ${editing ? 'xl:grid-cols-[1.7fr_1fr]' : ''} gap-5 items-start`}>
        <DsCard noPadding testId={draft ? 'duty-draft' : 'duty-active'} icon="globe"
          title={shown ? `Duty and tax rates · version ${shown.version}${draft ? ' · draft' : ''}` : 'Duty and tax rates'}
          subtitle={draft
            ? (draft.submitted_at
              ? `Sent for approval by ${draft.submitted_by_name ?? 'staff'} on ${fmtDate(draft.submitted_at)}.`
              : 'Entries come from official sources and stay ‘Verify’ until someone checks them.')
            : shown?.effective_from ? `Active since ${fmtDate(shown.effective_from)}.` : undefined}
          actions={draft && access.canEdit ? (
            <>
              {!draft.submitted_at && (
                <DsButton disabled={pending || shownEntries.length === 0 || openEntries > 0}
                  disabledReason={shownEntries.length === 0 ? 'Add an entry first' : openEntries > 0 ? `${openEntries} entr${openEntries === 1 ? 'y needs' : 'ies need'} confirming` : undefined}
                  testId="duty-submit" onClick={() => run(() => submitDutyVersionAction(draft.id))}>Send for approval</DsButton>
              )}
              <DsButton variant="secondary" icon="plus" testId="duty-add-entry" onClick={() => setEditing('new')}>Add entry</DsButton>
            </>
          ) : undefined}>
          {!shown ? (
            <div className="p-5"><DsEmptyState icon="globe" title="No duty table yet" description="Create the first version. Until an entry exists for a country, duties show as “not known yet”." /></div>
          ) : (
            <>
              <p className="m-0 px-5 py-3 text-[13px] text-muted" data-testid="duty-summary">
                {shownEntries.length} entr{shownEntries.length === 1 ? 'y' : 'ies'}
                {diff ? ` · ${diff.changed} changed, ${diff.added} new${diff.removed ? `, ${diff.removed} removed` : ''} since version ${active?.version}` : ''}. Default = country default (blank HS prefix).
              </p>
              {shownEntries.length === 0 ? <p className="m-0 px-5 pb-4 text-[13px]">No entries yet.</p> : (
                <div className="ds-scroll">
                  <table className="ds-tbl min-w-[980px]" data-testid="duty-entries">
                    <thead><tr>
                      <th scope="col">Country</th><th scope="col">HS prefix</th><th scope="col">Duty</th><th scope="col">Import tax</th>
                      <th scope="col">De minimis</th><th scope="col">Applies to</th><th scope="col">Source</th><th scope="col">Status</th>
                      {draft && access.canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}
                    </tr></thead>
                    <tbody>
                      {shownEntries.map((e) => {
                        const mark = diff?.mark.get(e.id);
                        const mine = e.edited_by === access.userId;
                        return (
                          <tr key={e.id} data-testid={`duty-entry-${e.country}-${e.hs_prefix ?? 'default'}`}>
                            <td>{COUNTRY_NAMES[e.country] ?? e.country}{mark && <span className="ml-2"><DsBadge tone="info">{mark === 'new' ? 'New' : 'Changed'}</DsBadge></span>}</td>
                            <td className="font-mono">{e.hs_prefix ?? 'Default'}</td>
                            <td>{e.country === 'US' && e.duty_bp == null ? 'By tariff code' : pct(e.duty_bp)}</td>
                            <td>{pct(e.tax_bp)}</td>
                            <td>{e.country === 'US' ? 'None (suspended)' : Number(e.de_minimis_cents) ? money(Number(e.de_minimis_cents), 'USD') : 'None'}</td>
                            <td>{e.country === 'US' || !Number(e.de_minimis_cents) ? '—' : e.de_minimis_applies_to === 'duty_and_tax' ? 'Duty and tax' : 'Duty only'}</td>
                            <td className="text-[12.5px]">{sourceLink(e.source)}</td>
                            <td><DsBadge tone={ENTRY_TONE[e.status] ?? 'neutral'}>{ENTRY_LABEL[e.status] ?? e.status}</DsBadge></td>
                            {draft && access.canEdit && (
                              <td>
                                {!draft.submitted_at && (
                                  <div className="flex flex-wrap gap-1 items-start">
                                    {e.status === 'verify' && (
                                      <DsButton variant="secondary" disabled={pending || mine} disabledReason={mine ? 'You entered this; a second person confirms it' : undefined}
                                        testId={`duty-confirm-${e.country}-${e.hs_prefix ?? 'default'}`} onClick={() => run(() => confirmDutyEntryAction(e.id))}>Confirm</DsButton>
                                    )}
                                    <DsButton variant="link" onClick={() => setEditing(e)}>Edit</DsButton>
                                    <DsButton variant="link" disabled={pending} onClick={() => run(() => deleteDutyEntryAction(e.id))}>Remove</DsButton>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </DsCard>

        {editing && draft && (
          <DsCard title={editing === 'new' ? 'Add entry' : 'Edit entry'} icon="pencil" testId="duty-edit">
            <EntryForm key={editing === 'new' ? 'new' : editing.id} versionId={draft.id} entry={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)} pending={pending} run={run} />
          </DsCard>
        )}
      </div>

      {draft?.submitted_at && (
        <DsCard title={`Publish version ${draft.version}`} icon="check" testId="duty-publish">
          <dl className="grid grid-cols-[170px_1fr] gap-x-3 gap-y-1 m-0 text-[13.5px]">
            <dt className="text-muted">Changes vs version {active?.version ?? '—'}</dt>
            <dd className="m-0">{diff ? `${diff.changed} changed · ${diff.added} new${diff.removed ? ` · ${diff.removed} removed` : ''}` : `${draft.entries} entries (first version)`}</dd>
            <dt className="text-muted">Proposed by</dt><dd className="m-0">{draft.submitted_by_name ?? draft.created_by_name ?? 'Staff'}</dd>
            <dt className="text-muted">Effective from</dt><dd className="m-0">When approved</dd>
            <dt className="text-muted">Paid orders</dt><dd className="m-0">Keep the version they were quoted with</dd>
          </dl>
          {access.canPublish ? (
            <div className="mt-3">
              {rejecting === draft.id ? (
                <ReasonForm label="Why is it sent back?" button="Reject" pending={pending} onCancel={() => setRejecting(null)}
                  onSubmit={(r) => run(() => rejectDutyVersionAction(draft.id, r), () => setRejecting(null))} />
              ) : (
                <div className="flex flex-wrap gap-2 items-start">
                  <DsButton disabled={pending || preparedByMe} disabledReason={preparedByMe ? 'Approver must be a different person.' : undefined}
                    testId="duty-publish-approve" onClick={() => run(() => publishDutyVersionAction(draft.id))}>Approve and publish</DsButton>
                  <DsButton variant="secondary" disabled={pending} testId="duty-publish-reject" onClick={() => setRejecting(draft.id)}>Reject</DsButton>
                </div>
              )}
            </div>
          ) : <p className="mt-2 mb-0 text-[13px] text-muted">Approver must be a different person with publish rights.</p>}
        </DsCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <DsCard title="Customs value policy" icon="shield" testId="customs-policy"
          subtitle={activePolicy ? `Version ${activePolicy.version}, from ${fmtDate(activePolicy.effective_from)}` : 'Not approved yet'}>
          <dl className="grid grid-cols-[200px_1fr] gap-x-3 gap-y-2 m-0 text-[13.5px]">
            <dt className="text-muted">Declared value</dt><dd className="m-0">The price the buyer paid, from the store order</dd>
            <dt className="text-muted">Locked</dt><dd className="m-0">At payment, saved with the order snapshot</dd>
            <dt className="text-muted">Block the label if declared value is below</dt>
            <dd className="m-0" data-testid="customs-threshold">{activePolicy?.block_below_pct != null ? `${Number(activePolicy.block_below_pct)}% of the store price` : 'Not set'}</dd>
            <dt className="text-muted">Shipping in declared value</dt>
            <dd className="m-0">{SHIPPING_RULE[activePolicy?.shipping_in_declared_value ?? 'follow_destination']}</dd>
          </dl>
          <p className="mt-3 mb-0 text-[12.5px] text-muted">Never the cost price. Confirm destination rules with the carrier or customs broker.</p>

          {pendingPolicy && (
            <div className="mt-4 border-t border-line pt-3 flex flex-col gap-2" data-testid="customs-pending">
              <p className="m-0 text-[13.5px]"><strong>Waiting for approval:</strong> version {pendingPolicy.version} · threshold {pendingPolicy.block_below_pct != null ? `${Number(pendingPolicy.block_below_pct)}%` : 'not set'} · {SHIPPING_RULE[pendingPolicy.shipping_in_declared_value]} · proposed by {pendingPolicy.proposed_by_name ?? 'staff'}</p>
              {(access.canPublish || access.canEdit) && (rejecting === pendingPolicy.id ? (
                <ReasonForm label="Why is it rejected?" button="Reject" pending={pending} onCancel={() => setRejecting(null)}
                  onSubmit={(r) => run(() => rejectCustomsPolicyAction(pendingPolicy.id, r), () => setRejecting(null))} />
              ) : (
                <div className="flex flex-wrap gap-2 items-start">
                  {access.canPublish && (
                    <DsButton disabled={pending || pendingPolicy.proposed_by === access.userId}
                      disabledReason={pendingPolicy.proposed_by === access.userId ? 'Approver must be a different person.' : undefined}
                      testId="customs-approve" onClick={() => run(() => approveCustomsPolicyAction(pendingPolicy.id))}>Approve</DsButton>
                  )}
                  <DsButton variant="secondary" disabled={pending} onClick={() => setRejecting(pendingPolicy.id)}>Reject</DsButton>
                </div>
              ))}
            </div>
          )}

          {access.canEdit && !pendingPolicy && (
            <form className="mt-4 border-t border-line pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="customs-propose"
              onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => proposeCustomsPolicyAction(fd)); }}>
              <DsInput label="Block below (% of store price)" name="block_below_pct" inputMode="decimal" hint="Empty = not set"
                defaultValue={activePolicy?.block_below_pct != null ? String(Number(activePolicy.block_below_pct)) : ''} />
              <DsSelect label="Shipping in declared value" name="shipping_rule" defaultValue={activePolicy?.shipping_in_declared_value ?? 'follow_destination'}>
                {Object.entries(SHIPPING_RULE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </DsSelect>
              <DsInput label="Note" name="note" containerClassName="sm:col-span-2" placeholder="Why this change" />
              <div className="sm:col-span-2"><DsButton type="submit" variant="secondary" disabled={pending} testId="customs-propose-submit">Propose a new version</DsButton></div>
            </form>
          )}
        </DsCard>

        <DsCard title="Data completeness" icon="chart" testId="data-completeness"
          subtitle={completeness ? `${completeness.published} published product${completeness.published === 1 ? '' : 's'}` : undefined}>
          <dl className="grid grid-cols-1 gap-3 m-0 text-[13.5px]">
            <div><dt className="text-muted">HS codes checked</dt><dd className="m-0 font-semibold">{completeness ? `${share(completeness.hs_verified)} of published products (${completeness.hs_verified}/${completeness.published})` : '—'}</dd></div>
            <div><dt className="text-muted">Weight and box size</dt><dd className="m-0 font-semibold">{completeness ? `${share(completeness.weight_and_box)} (${completeness.weight_and_box}/${completeness.published})` : '—'}</dd></div>
            <div><dt className="text-muted">Restricted flags confirmed</dt><dd className="m-0">Not recorded yet: flags are stored per item but there is no separate “confirmed” check.</dd></div>
          </dl>
        </DsCard>
      </div>

      <Message m={msg} />

      <DsCard title="History" icon="clock" noPadding>
        {versions.length === 0 ? <div className="p-4"><DsEmptyState title="No versions yet" description="Create the first version above." /></div> : (
          <div className="ds-scroll">
            <table className="ds-tbl min-w-[820px]" data-testid="duty-history">
              <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Entries</th><th scope="col">Prepared</th><th scope="col">Published</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono">v{v.version}</td>
                    <td><DsBadge tone={v.status === 'active' ? 'ok' : v.status === 'draft' ? 'warn' : 'neutral'}>{v.status === 'active' ? 'Active' : v.status === 'draft' ? (v.submitted_at ? 'Waiting for approval' : 'Draft') : 'Replaced'}</DsBadge></td>
                    <td>{v.confirmed}/{v.entries} confirmed</td>
                    <td>{v.submitted_by_name ?? v.created_by_name ?? '—'}<div className="text-[12px] text-muted">{fmtDate(v.submitted_at ?? v.created_at)}</div></td>
                    <td>{v.activated_by_name ?? '—'}{v.effective_from && <div className="text-[12px] text-muted">{fmtDate(v.effective_from)}</div>}</td>
                    <td className="text-[12.5px] whitespace-pre-line">{v.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>
    </div>
  );
}
