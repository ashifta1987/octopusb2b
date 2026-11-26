import Link from 'next/link';
import { DsBadge } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { DG_LABEL, EVIDENCE_LABEL, ORDER_STATUS, type EvidenceKind } from '@/lib/warehouse-orders';

/** Small presentational pieces shared by the W3a staff screens (server or client). */
export function OrderStatusBadge({ status, testId }: { status: string; testId?: string }) {
  const [label, tone] = ORDER_STATUS[status] ?? [status, 'neutral'];
  return <DsBadge tone={tone} testId={testId}>{label}</DsBadge>;
}

export function DgBadge({ kinds }: { kinds: string[] }) {
  if (!kinds.length) return null;
  return <DsBadge tone="warn" icon="alert" testId="wh-dg-badge">Dangerous goods: {kinds.map((k) => DG_LABEL[k] ?? k).join(', ')}</DsBadge>;
}

export function OrderLink({ code, href }: { code: string; href?: string }) {
  return <Link href={href ?? `/office/warehouse/orders/${code}`} className="font-mono font-semibold text-[#2559B8] underline">{code}</Link>;
}

/** Packing photos (signed URLs, valid for a few minutes). */
export function EvidenceGallery({ items, testId = 'wh-evidence-gallery' }: {
  items: { kind: EvidenceKind; url?: string | null; at: string; retention_until: string; by_name?: string | null }[]; testId?: string;
}) {
  if (!items.length) return <p className="m-0 text-[13px] text-[#5B6478]" data-testid={`${testId}-empty`}>No photos yet.</p>;
  return (
    <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid={testId}>
      {items.map((e, i) => (
        <li key={i} className="rounded-[10px] border border-[#E3E7EF] overflow-hidden bg-white" data-testid={`wh-photo-${e.kind}`}>
          {e.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={e.url} alt={`${EVIDENCE_LABEL[e.kind]} photo`} className="w-full h-[180px] object-cover block bg-[#F4F6F9]" />
          ) : (
            <div className="h-[180px] flex items-center justify-center text-[13px] text-[#5B6478] bg-[#F4F6F9]">Photo unavailable</div>
          )}
          <div className="p-2.5 text-[12.5px]">
            <div className="font-semibold">{EVIDENCE_LABEL[e.kind]}</div>
            <div className="text-[#5B6478]">{fmtWh(e.at)}{e.by_name ? ` · ${e.by_name}` : ''}</div>
            <div className="text-[#5B6478]">Kept until {fmtWh(e.retention_until)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
