import Image from 'next/image';
import { Box, FileText, ImageIcon, Package, Sparkles, Users, Warehouse, type LucideIcon } from 'lucide-react';
import { Icon, cx } from '@octopus/ui';
import type { BuyKind, CartImage } from '../../_lib/cart-types';
import { KIND_LABEL } from '../_lib/cart-ui';

/**
 * ODS T5a · cart line pieces (server-safe, no hooks): the type tag (Part 5.8 "type tag") and the line image.
 * Tags use navy text on a service tint (contrast ≥ 4.5:1) with the icon; colour is never the only signal (the label says it).
 */
const TAG: Record<BuyKind | 'quote', { icon: LucideIcon; cls: string; label: string }> = {
  sample: { icon: Box, cls: 'bg-ods-blue-tint', label: KIND_LABEL.sample },
  stock: { icon: Package, cls: 'bg-ods-success-tint', label: KIND_LABEL.stock },
  pool: { icon: Users, cls: 'bg-ods-svc-pools-tint', label: KIND_LABEL.pool },
  brand: { icon: Sparkles, cls: 'bg-ods-svc-brand-tint', label: KIND_LABEL.brand },
  service: { icon: Warehouse, cls: 'bg-ods-svc-3pl-tint', label: KIND_LABEL.service },
  quote: { icon: FileText, cls: 'bg-ods-info-tint', label: 'Needs a quote' },
};

export function KindTag({ kind, className }: { kind: BuyKind | 'quote'; className?: string }) {
  const t = TAG[kind];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-ods-pill px-2 py-0.5 text-ods-small font-semibold text-ods-navy', t.cls, className)} data-kind={kind}>
      <Icon icon={t.icon} size="xs" />
      {t.label}
    </span>
  );
}

export function LineImage({ image, size = 72 }: { image: CartImage | null; size?: 48 | 72 }) {
  const box = size === 48 ? 'size-12' : 'size-18';
  if (!image) {
    return (
      <span aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-ods-control bg-ods-canvas text-ods-slate', box)}>
        <Icon icon={ImageIcon} size="sm" />
      </span>
    );
  }
  return (
    <span className={cx('relative block shrink-0 overflow-hidden rounded-ods-control bg-ods-canvas', box)}>
      <Image src={image.src} alt={image.alt} fill sizes={`${size}px`} unoptimized={image.unoptimized} className="object-cover" />
    </span>
  );
}
