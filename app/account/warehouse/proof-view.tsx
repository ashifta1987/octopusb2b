import Link from 'next/link';
import { fmtWh } from '@/lib/warehouse-inbound';
import { EVIDENCE_LABEL, clientSteps, grams, type PortalProof } from '@/lib/warehouse-orders';

/**
 * Board 19 proof view (W3a; W5 polish): the client's own order — contents, step tracker, photos (signed URLs), weight check,
 * scan log, retention, link to tracking once shipped, and a shortcut to ask about the order with the record attached.
 */
export type ProofOrder = { lines: { sku: string; name: string; qty: number }[]; shipped_at?: string | null; tracking_token?: string | null; ship_name: string; ship_country: string };

export function ProofView({ proof: p, order }: { proof: PortalProof; order?: ProofOrder | null }) {
  const steps = p.status === 'cancelled' ? [] : clientSteps(p.status);
  return (
    <section className="card p-5 mt-5" aria-labelledby="wh-proof" data-testid="wh-proof">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="wh-proof" className="text-[18px] font-semibold m-0">Packing proof · {p.code}</h2>
        {p.external_ref && <span className="text-[13px] text-black/70">Your order {p.external_ref}</span>}
        <Link href="/account/warehouse?tab=orders" className="ml-auto text-[14px] underline">Back to orders</Link>
      </div>
      {steps.length > 0 && (
        <ol className="list-none mt-3 mb-0 p-0 flex flex-wrap gap-1.5 text-[12px]" aria-label="Order steps">
          {steps.map((s) => (
            <li key={s.label} aria-current={s.state === 'current' ? 'step' : undefined}
              className={`px-2 py-0.5 rounded-full border ${s.state === 'done' ? 'bg-ink text-white border-ink' : s.state === 'current' ? 'border-ink font-semibold' : 'border-line text-black/70'}`}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {order && order.lines.length > 0 && (
        <div className="mt-3" data-testid="wh-proof-contents">
          <h3 className="m-0 mb-1 text-[15px] font-semibold">Contents</h3>
          <ul className="m-0 pl-5 text-[13.5px]">
            {order.lines.map((l) => <li key={l.sku}><span className="font-mono">{l.sku}</span> · {l.name} × {l.qty}</li>)}
          </ul>
          <p className="mt-1 mb-0 text-[13px] text-black/70">To {order.ship_name} · {order.ship_country}</p>
        </div>
      )}
      {!p.packed ? (
        <p className="mt-3 mb-0 text-[14px]" data-testid="wh-proof-pending">This order is not packed yet. The proof appears here once the parcel is closed.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 m-0 text-[14px]">
            <dt className="text-black/70">Packed</dt><dd className="m-0">{fmtWh(p.packed_at)} China time{p.warehouse ? ` · ${p.warehouse}` : ''}</dd>
            {p.box && <><dt className="text-black/70">Box</dt><dd className="m-0">{p.box}</dd></>}
            <dt className="text-black/70">Weight check</dt>
            <dd className="m-0" data-testid="wh-proof-weight">
              {grams(p.measured_weight_g)} measured{p.expected_weight_g != null ? ` · ${grams(p.expected_weight_g)} expected` : ''} ·{' '}
              {p.weight_check === 'within' ? 'inside tolerance' : 'checked and approved by a warehouse supervisor'}
            </dd>
            {p.has_dangerous_goods && <><dt className="text-black/70">Battery mark</dt><dd className="m-0">{p.battery_mark ? 'Applied' : 'Not applied'}</dd></>}
            <dt className="text-black/70">Photos kept until</dt><dd className="m-0">{p.retention_until ? fmtWh(p.retention_until) : '—'}</dd>
          </dl>
          {p.evidence.length === 0 ? <p className="mt-3 mb-0 text-[14px] text-black/75">The photos are no longer kept.</p> : (
            <ul className="mt-4 mb-0 p-0 list-none grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="wh-proof-photos">
              {p.evidence.map((e, i) => (
                <li key={i} className="rounded-[10px] border border-line overflow-hidden">
                  {e.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.url} alt={`${EVIDENCE_LABEL[e.kind]} photo of ${p.code}`} className="w-full h-[200px] object-cover block" />
                  ) : <div className="h-[200px] flex items-center justify-center text-[13px] text-black/70">Photo unavailable</div>}
                  <div className="p-2.5 text-[13px]"><strong>{EVIDENCE_LABEL[e.kind]}</strong> · {fmtWh(e.at)}</div>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-5 mb-2 text-[15px] font-semibold">Scan log</h3>
          <ul className="m-0 pl-5 text-[13.5px]" data-testid="wh-proof-scans">
            {p.scans.map((s, i) => <li key={i}>{fmtWh(s.at)} · {s.sku} · {s.name}</li>)}
          </ul>
          {order?.tracking_token ? (
            <p className="mt-3 mb-0 text-[14px]" data-testid="wh-proof-tracking">
              Shipped {fmtWh(order.shipped_at)}. <Link href={`/t/${order.tracking_token}`} target="_blank" className="underline">Open tracking<span className="sr-only"> for {p.code} (the page your customer sees)</span></Link>
            </p>
          ) : (
            <p className="mt-3 mb-0 text-[13px] text-black/70">Tracking appears here once the parcel is labelled and handed to the carrier.</p>
          )}
        </>
      )}
      <p className="mt-3 mb-0 text-[13.5px]">
        Something wrong with this order? <Link href={`/account/warehouse?tab=support&ref=${p.code}`} className="underline" data-testid="wh-proof-support">Ask us about {p.code}</Link> — our team sees this packing record.
      </p>
    </section>
  );
}
