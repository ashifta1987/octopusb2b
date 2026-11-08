/** HS code with its status (6 Nov 2026): confirmed (green) · suggested (amber, check it) · missing. */
export function HsCode({ code, status, source, note, compact = false }: { code: string | null; status?: string | null; source?: string | null; note?: string | null; compact?: boolean }) {
  if (!code) return <span className="text-bad font-semibold" data-testid="hs-missing">Missing HS code{note && !compact ? <span className="font-normal text-muted"> · {note}</span> : null}</span>;
  const suggested = status === 'suggested';
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="hs-code" data-status={status ?? 'confirmed'}>
      <span className="mono font-semibold">{code}</span>
      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${suggested ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>
        {suggested ? `Suggested${source === 'ai' ? ' (AI)' : ''}` : 'Confirmed'}
      </span>
    </span>
  );
}
