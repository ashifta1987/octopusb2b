import {
  Bolt, Hammer, ShieldCheck, Zap, Package, Gauge, Forklift, FlaskConical, Paperclip, Shirt, Tag, LayoutGrid, type LucideIcon,
} from 'lucide-react';

/** Main.png category bar: one icon per top-level category (matched on the slug; generic tag icon otherwise). Decorative only. */
// [slug pattern, icon, stroke colour from docs/design/html/Main.html]
const ICONS: [RegExp, LucideIcon, string][] = [
  [/fastener|bolt|screw/, Bolt, 'var(--needs)'],
  [/tool/, Hammer, 'var(--coral-text)'],
  [/safety|ppe/, ShieldCheck, 'var(--green-ink)'],
  [/electric|cable|light/, Zap, 'var(--amber-ink)'],
  [/packag|box/, Package, 'var(--violet)'],
  [/hydraul|pneumat|valve|pump/, Gauge, 'var(--cyan)'],
  [/handling|lift|storage/, Forklift, 'var(--red-ink)'],
  [/chemical|lab/, FlaskConical, 'var(--ink-2)'],
  [/office|stationery/, Paperclip, 'var(--ink)'],
  [/textile|apparel|fabric|workwear/, Shirt, 'var(--pink)'],
];

export function CategoryIcon({ slug, className = 'w-4 h-4' }: { slug: string; className?: string }) {
  const hit = ICONS.find(([re]) => re.test(slug));
  const Icon = hit?.[1] ?? Tag;
  return <Icon className={className} strokeWidth={2} color={hit?.[2] ?? 'currentColor'} aria-hidden focusable="false" />;
}

export function AllCategoriesIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return <LayoutGrid className={className} strokeWidth={2} aria-hidden focusable="false" />;
}
