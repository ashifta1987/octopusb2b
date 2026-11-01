import {
  Bolt, Hammer, ShieldCheck, Zap, Package, Gauge, Forklift, FlaskConical, Paperclip, Shirt, Tag, LayoutGrid, type LucideIcon,
} from 'lucide-react';

/** Main.png category bar: one icon per top-level category (matched on the slug; generic tag icon otherwise). Decorative only. */
// [slug pattern, icon, stroke colour from docs/design/html/Main.html]
const ICONS: [RegExp, LucideIcon, string][] = [
  [/fastener|bolt|screw/, Bolt, '#B45309'],
  [/tool/, Hammer, '#1E40AF'],
  [/safety|ppe/, ShieldCheck, '#166534'],
  [/electric|cable|light/, Zap, '#854D0E'],
  [/packag|box/, Package, '#6B21A8'],
  [/hydraul|pneumat|valve|pump/, Gauge, '#155E75'],
  [/handling|lift|storage/, Forklift, '#9F1239'],
  [/chemical|lab/, FlaskConical, '#3730A3'],
  [/office|stationery/, Paperclip, '#1E3A8A'],
  [/textile|apparel|fabric|workwear/, Shirt, '#9D174D'],
];

export function CategoryIcon({ slug, className = 'w-4 h-4' }: { slug: string; className?: string }) {
  const hit = ICONS.find(([re]) => re.test(slug));
  const Icon = hit?.[1] ?? Tag;
  return <Icon className={className} strokeWidth={2} color={hit?.[2] ?? 'currentColor'} aria-hidden focusable="false" />;
}

export function AllCategoriesIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return <LayoutGrid className={className} strokeWidth={2} aria-hidden focusable="false" />;
}
