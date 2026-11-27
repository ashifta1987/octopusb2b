'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Check } from 'lucide-react';
import { addToQuoteList, recordView } from '@/app/shop/actions';

/** CH-1 "Add to quote list" (cards + product page). Refreshes the header count; the result is announced (aria-live). */
export function AddToList({ productId, title, quantity, size = 'sm', className = '' }: {
  productId: string; title: string; quantity?: number; size?: 'sm' | 'md'; className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  const add = () => start(async () => {
    const r = await addToQuoteList(productId, quantity);
    if (r.ok) { setState({ ok: true, msg: `Added. ${r.count} in your quote list.` }); router.refresh(); }
    else setState({ ok: false, msg: r.error });
  });
  return (
    <div className={className}>
      {state?.ok ? (
        <Link href="/shop/quote-list" className={`btn btn-ghost ${size === 'sm' ? 'btn-sm' : ''} w-full`} data-testid="added-to-list">
          <Check size={16} strokeWidth={1.9} aria-hidden /> View quote list
        </Link>
      ) : (
        <button type="button" onClick={add} disabled={pending} aria-busy={pending} className={`btn btn-ghost ${size === 'sm' ? 'btn-sm' : ''} w-full`} data-testid="add-to-list">
          <Plus size={16} strokeWidth={1.9} aria-hidden /> {pending ? 'Adding…' : 'Add to quote list'}<span className="sr-only">: {title}</span>
        </button>
      )}
      <p role="status" aria-live="polite" className={`m-0 mt-1 text-[12.5px] ${state && !state.ok ? 'text-bad' : 'text-muted'} ${state ? '' : 'sr-only'}`}>{state?.msg ?? ''}</p>
    </div>
  );
}

/** Records a product view once the page is shown in the browser (never during server render or a prefetch). */
export function RecordView({ productId }: { productId: string }) {
  useEffect(() => { recordView(productId).catch(() => {}); }, [productId]);
  return null;
}
