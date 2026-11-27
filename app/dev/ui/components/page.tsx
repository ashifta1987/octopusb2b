import type { Metadata } from 'next';
import Link from 'next/link';
import { GROUPS } from './_groups';

export const metadata: Metadata = { title: 'ODS 1.0 components (staging)', robots: { index: false, follow: false } };

const NOTES: Record<string, string> = {
  '/dev/ui/components/navigation': 'PublicHeader, ShopHeader, SectionBar, MegaMenu, AccountSidebar, AccountTopbar, OfficeTopbar, OfficeSidebar, BottomNav, Sheet, Breadcrumbs',
  '/dev/ui/components/selection': 'Tabs, FilterPills, Segmented, CardTabs, Stepper, JumpBar',
  '/dev/ui/components/content': 'Button, Card, Panel, ServiceSection, product cards, KpiStrip, DataTable, StatusPill, Money, Timeline, ActivityFeed, EmptyState, ErrorState, Skeleton',
  '/dev/ui/components/forms': 'Field, Input, Select, Textarea, NumberInput, QuantityStepper, DateInput, FileDrop, RadioCards, Checkbox, Switch, Drawer, Modal, Toast, Tooltip, ContextMenu',
  '/dev/ui/components/data': 'OctopusDataGrid, Workspace tabs, CommandPalette, keyboard shortcuts',
};

export default function DevComponentsIndex() {
  return (
    <>
      <h1>ODS 1.0 components</h1>
      <p className="mt-2 max-w-[760px] text-ods-slate">
        Every Part 2.5 component in every state, in both densities. Source: <code>packages/ui/src/components</code>, imported as{' '}
        <code>@octopus/ui</code>. This page returns 404 on the live site.
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-ods-gap ods-tablet:grid-cols-2">
        {GROUPS.filter((g) => g.href !== '/dev/ui').map((g) => (
          <li key={g.href}>
            <Link href={g.href} className="block h-full rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card hover:border-ods-blue">
              <span className="block text-ods-h2 font-bold text-ods-navy">{g.label}</span>
              <span className="mt-1 block text-ods-small text-ods-slate">{NOTES[g.href]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
