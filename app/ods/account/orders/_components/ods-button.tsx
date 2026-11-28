'use client';

import { ArrowLeft, ArrowRight, DollarSign, Download, Eye, FileText, HelpCircle, LayoutGrid, List, MessageSquare, Plus, Truck, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from '@octopus/ui';

/** Icon names server components can pass (a lucide component itself can't cross the server → client boundary). */
export const ODS_BUTTON_ICONS = {
  plus: Plus,
  message: MessageSquare,
  download: Download,
  wallet: Wallet,
  eye: Eye,
  truck: Truck,
  dollar: DollarSign,
  users: Users,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  help: HelpCircle,
  file: FileText,
  list: List,
  board: LayoutGrid,
} satisfies Record<string, LucideIcon>;
export type OdsIconKey = keyof typeof ODS_BUTTON_ICONS;

/** `Button` for server-rendered views: icons by name (`icon="download"`). Everything else is Button's API. */
export function OdsButton({ icon, iconEnd, ...rest }: Omit<ButtonProps, 'iconStart' | 'iconEnd'> & { icon?: OdsIconKey; iconEnd?: OdsIconKey }) {
  return <Button {...rest} iconStart={icon ? ODS_BUTTON_ICONS[icon] : undefined} iconEnd={iconEnd ? ODS_BUTTON_ICONS[iconEnd] : undefined} />;
}
