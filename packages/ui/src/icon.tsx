import type { CSSProperties } from 'react';
import { Box, Layers, Package, Sparkles, Truck, Users, type LucideIcon, type LucideProps } from 'lucide-react';
import type { OdsServiceKey } from './tokens';

/**
 * Lucide sizes from Part 2.4: 14 px compact, 16–18 px comfortable, 20–22 px phone bottom bar. Stroke 1.9.
 * `auto` (default) follows the density token --ods-icon (18 comfortable, 14 compact).
 */
export const ODS_ICON_SIZES = { xs: 14, sm: 16, md: 18, lg: 20, xl: 22 } as const;
export const ODS_ICON_STROKE = 1.9;
export type OdsIconSize = keyof typeof ODS_ICON_SIZES | 'auto';

export type IconProps = Omit<LucideProps, 'size' | 'strokeWidth' | 'ref'> & {
  icon: LucideIcon;
  size?: OdsIconSize;
  /**
   * Only for a meaningful icon with no text next to it (it becomes role="img" with this name). Icons next to text are
   * decorative and stay aria-hidden (the default). Icon-only BUTTONS put the aria-label on the button instead.
   */
  label?: string;
};

export function Icon({ icon: Glyph, size = 'auto', label, style, className, ...rest }: IconProps) {
  const px = size === 'auto' ? undefined : ODS_ICON_SIZES[size];
  const sizing: CSSProperties | undefined = px ? undefined : { width: 'var(--ods-icon)', height: 'var(--ods-icon)' };
  const a11y = label ? { role: 'img' as const, 'aria-label': label, 'aria-hidden': false as const } : { 'aria-hidden': true as const, focusable: 'false' as const };
  return (
    <Glyph
      size={px ?? 24}
      strokeWidth={ODS_ICON_STROKE}
      className={['shrink-0', className].filter(Boolean).join(' ')}
      style={sizing ? { ...sizing, ...style } : style}
      data-ods-icon={size}
      {...a11y}
      {...rest}
    />
  );
}

/** The six service icons (Part 2.2 table): box, users, truck, package, layers, sparkle. */
export const ODS_SERVICE_ICONS: Record<OdsServiceKey, LucideIcon> = {
  sourcing: Box,
  pools: Users,
  dropship: Truck,
  '3pl': Package,
  turnkey: Layers,
  brand: Sparkles,
};
