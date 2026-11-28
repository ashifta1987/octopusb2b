'use client';

import { useEffect, useState } from 'react';
import { Money, Skeleton, formatDate } from '@octopus/ui';
import { currencyPrefix, journalTotals, refHref, type JournalView } from './accounts-core';
import { DetailRow } from './accounts-list-screen';

export type JournalLoader = (by: { journalId: string } | { refType: 'payment'; refId: string }) => Promise<{ ok: true; journal: JournalView | null } | { ok: false; error: string }>;

/** Journal + lines (debit / credit per account, totals per currency) for Ledger and Payments drawers. */
export function JournalPanel({ by, load, onOpen, emptyText = 'No ledger journal is linked to this record.' }: { by: { journalId: string } | { refType: 'payment'; refId: string } | null; load: JournalLoader; onOpen: (href: string, title: string) => void; emptyText?: string }) {
  const key = by ? ('journalId' in by ? by.journalId : `${by.refType}:${by.refId}`) : '';
  const [state, setState] = useState<{ key: string; r: Awaited<ReturnType<JournalLoader>> } | null>(null);
  useEffect(() => {
    if (!by) return;
    let live = true;
    load(by).then(
      (r) => live && setState({ key, r }),
      () => live && setState({ key, r: { ok: false, error: 'We couldn’t load the journal.' } }),
    );
    return () => {
      live = false;
    };
    // `by` is described by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  if (!by) return <p className="m-0 text-ods-small text-ods-slate">{emptyText}</p>;
  const r = state?.key === key ? state.r : null;
  if (!r) return <Skeleton lines={4} label="Loading journal" />;
  if (!r.ok) return <p className="m-0 rounded-ods-control border border-ods-danger/30 bg-ods-danger-tint px-3 py-2 text-ods-small text-ods-danger">{r.error}</p>;
  const j = r.journal;
  if (!j) return <p className="m-0 text-ods-small text-ods-slate">{emptyText}</p>;
  const ref = refHref(j.refType, j.refId);
  const totals = journalTotals(j.lines.map((l) => ({ debit: l.debitMinor, credit: l.creditMinor, currency: l.currency })));
  return (
    <div className="flex flex-col gap-3" data-testid="journal-panel">
      <dl className="m-0">
        <DetailRow k="Journal">
          <span className="font-mono">{j.number}</span>
        </DetailRow>
        <DetailRow k="Date">{formatDate(j.at)}</DetailRow>
        <DetailRow k="Memo">{j.memo || '—'}</DetailRow>
        <DetailRow k="Stream">{j.stream ?? '—'}</DetailRow>
        <DetailRow k="Reference">
          {ref ? (
            <a
              href={ref}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.button !== 0) return;
                e.preventDefault();
                onOpen(ref, j.refType ?? 'Record');
              }}
              className="font-semibold text-ods-info underline"
            >
              Open {j.refType?.replace(/_/g, ' ')}
            </a>
          ) : (
            (j.refType?.replace(/_/g, ' ') ?? '—')
          )}
        </DetailRow>
      </dl>
      <table className="w-full table-fixed border-separate border-spacing-0 text-ods-small">
        <caption className="sr-only">Journal lines</caption>
        <thead>
          <tr className="text-ods-slate">
            <th scope="col" className="w-1/2 border-b border-ods-line py-1 text-start font-semibold">
              Account
            </th>
            <th scope="col" className="border-b border-ods-line py-1 text-end font-semibold">
              Debit
            </th>
            <th scope="col" className="border-b border-ods-line py-1 text-end font-semibold">
              Credit
            </th>
          </tr>
        </thead>
        <tbody>
          {j.lines.map((l) => (
            <tr key={l.id}>
              <td className="truncate border-b border-ods-line py-1 pe-2" title={l.account}>
                {l.account}
              </td>
              <td className="border-b border-ods-line py-1 text-end tabular-nums">{l.debitMinor ? <Money amount={l.debitMinor / 100} currency={currencyPrefix(l.currency)} /> : ''}</td>
              <td className="border-b border-ods-line py-1 text-end tabular-nums">{l.creditMinor ? <Money amount={l.creditMinor / 100} currency={currencyPrefix(l.currency)} /> : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totals.map((t) => (
            <tr key={t.currency} className="font-semibold">
              <th scope="row" className="py-1 text-start">
                Total {t.currency}
                {t.balanced ? '' : ' · not balanced'}
              </th>
              <td className="py-1 text-end tabular-nums">
                <Money amount={t.debit / 100} currency={currencyPrefix(t.currency)} />
              </td>
              <td className="py-1 text-end tabular-nums">
                <Money amount={t.credit / 100} currency={currencyPrefix(t.currency)} />
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
