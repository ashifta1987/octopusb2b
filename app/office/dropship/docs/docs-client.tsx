'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsSelect, DsTableCard } from '@/components/dropship-ui';
import { DOC_KIND, DOC_STATUS, fmtDay } from '@/lib/dropship-ds14-shared';
import type { DocsPage } from '@/lib/dropship-ds14';
import { docStatusAction, linkDocAction, uploadDocAction } from '../ds14-actions';

export function DocsClient({ data, q, status, canEdit }: { data: DocsPage; q: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [search, setSearch] = useState(q);
  const [filter, setFilter] = useState(status);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const done = (r: { ok: boolean; message?: string }, okText: string) => { setMsg(r.ok ? { ok: true, text: r.message ?? okText } : { ok: false, text: r.message ?? 'Could not save.' }); if (r.ok) router.refresh(); };
  return (
    <div className="flex flex-col gap-5" data-testid="staff-docs-page">
      <DsPageHeader title="Docs" subtitle="Certificates, test reports and HS documents, linked to products." icon="file" />
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Could not do that'} testId="docs-msg">{msg.text}</DsNotice>}
      {canEdit && (
        <DsCard title="Add a document" subtitle="PDF, PNG or JPG up to 10 MB. Files are kept in a private bucket and opened with a 60-second link." icon="upload" testId="docs-upload">
          <form ref={form} className="grid sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); start(async () => { const r = await uploadDocAction(fd); done(r, 'Document added.'); if (r.ok) form.current?.reset(); }); }}>
            <DsInput label="Title" name="title" required />
            <DsSelect label="Type" name="kind" defaultValue="certificate">{Object.entries(DOC_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</DsSelect>
            <DsSelect label="Product" name="product_id" defaultValue=""><option value="">Link later</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.model_no} · {p.title}</option>)}</DsSelect>
            <DsInput label="Document number" name="doc_number" />
            <DsInput label="Issued by" name="issuer" />
            <DsInput label="Expires on" name="expires_on" type="date" />
            <label className="ds-label sm:col-span-2">File<input className="ds-input w-full" type="file" name="file" accept="application/pdf,image/png,image/jpeg" required aria-label="File" /></label>
            <div><DsButton type="submit" loading={pending} icon="upload">Upload</DsButton></div>
          </form>
        </DsCard>
      )}
      <form className="ds-card grid sm:grid-cols-4 gap-3 items-end" role="search" aria-label="Filter documents" onSubmit={(e) => { e.preventDefault(); router.push(`/office/dropship/docs?${new URLSearchParams(Object.entries({ q: search, status: filter }).filter(([, v]) => v)).toString()}`); }}>
        <DsInput label="Search title, product or model" value={search} onChange={(e) => setSearch(e.target.value)} />
        <DsSelect label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{Object.entries(DOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</DsSelect>
        <div className="flex gap-2"><DsButton type="submit" icon="search">Filter</DsButton><DsButton variant="secondary" onClick={() => { setSearch(''); setFilter(''); router.push('/office/dropship/docs'); }}>Clear</DsButton></div>
      </form>
      {data.docs.length === 0 ? (
        <DsEmptyState title="No documents yet" description="Add certificates and test reports here, then link them to products. Batteries and electronics need one before they are published." icon="file" />
      ) : (
        <DsTableCard title="Documents" headers={['Document', 'Product', 'Status', 'Expires', 'Actions']} minWidth={860} testId="docs-table">
          {data.docs.map((d) => {
            const st = DOC_STATUS[d.effective_status] ?? DOC_STATUS.pending;
            return (
              <tr key={d.id} data-testid="doc-row">
                <td className="font-semibold">{d.title}<div className="text-[12px] text-[#5B6478] font-normal">{DOC_KIND[d.kind]}{d.doc_number ? ` · ${d.doc_number}` : ''}{d.issuer ? ` · ${d.issuer}` : ''}</div>
                  <a className="text-[#2A6FD1] text-[13px] min-h-[44px] inline-flex items-center" href={`/office/dropship/docs/file/${d.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${d.title}`}>Open file</a></td>
                <td>{canEdit ? (
                  <select className="ds-input" aria-label={`Product for ${d.title}`} value={d.product_id ?? ''} onChange={(e) => start(async () => done(await linkDocAction(d.id, e.target.value || null), 'Link saved.'))}>
                    <option value="">Not linked</option>{data.products.map((p) => <option key={p.id} value={p.id}>{p.model_no} · {p.title}</option>)}
                  </select>) : d.product ? `${d.model_no} · ${d.product}` : 'Not linked'}</td>
                <td><DsBadge tone={st.tone}>{st.label}</DsBadge>{d.review_note && <div className="text-[12px] text-[#5B6478]">{d.review_note}</div>}</td>
                <td>{d.expires_on ? fmtDay(d.expires_on) : '—'}</td>
                <td>{canEdit && (
                  <div className="flex gap-2 flex-wrap items-end">
                    <DsButton variant="secondary" disabled={d.status === 'verified'} onClick={() => start(async () => done(await docStatusAction(d.id, 'verified', ''), 'Verified.'))} loading={pending} aria-label={`Verify ${d.title}`}>Verify</DsButton>
                    <DsInput label="Reason" aria-label={`Reason to reject ${d.title}`} value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} containerClassName="w-[160px]" />
                    <DsButton variant="danger" onClick={() => start(async () => done(await docStatusAction(d.id, 'rejected', notes[d.id] ?? ''), 'Rejected.'))} loading={pending} aria-label={`Reject ${d.title}`}>Reject</DsButton>
                  </div>)}</td>
              </tr>
            );
          })}
        </DsTableCard>
      )}
    </div>
  );
}
