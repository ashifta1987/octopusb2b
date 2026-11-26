import Link from 'next/link';

type Item = { key: string; href: string; label: string; testid: string };

/**
 * Turnkey T7 — the staff section menu (design staff header: Dashboard, Catalogue, Services, … Reports, Settings).
 * Settings and fee approvals are for admins; the pages check again.
 */
export function TurnkeyStaffNav({ current, isAdmin }: { current: string; isAdmin: boolean }) {
  const items: Item[] = [
    { key: 'dashboard', href: '/admin/turnkey', label: 'Dashboard', testid: 'tk-nav-dashboard' },
    { key: 'projects', href: '/admin/turnkey/projects', label: 'Client projects', testid: 'tk-admin-client-projects' },
    { key: 'catalogue', href: '/admin/turnkey?tab=catalogue', label: 'Catalogue', testid: 'tk-nav-catalogue' },
    { key: 'services', href: '/admin/turnkey?tab=services', label: 'Services and fees', testid: 'tk-nav-services' },
    { key: 'reports', href: '/admin/turnkey/reports', label: 'Reports', testid: 'tk-nav-reports' },
    ...(isAdmin ? [
      { key: 'approvals', href: '/admin/turnkey/approvals', label: 'Fee approvals', testid: 'tk-admin-fee-approvals' },
      { key: 'settings', href: '/admin/turnkey/settings', label: 'Settings', testid: 'tk-nav-settings' },
    ] : []),
    { key: 'leads', href: '/admin/turnkey?tab=leads', label: 'Old leads', testid: 'tk-nav-leads' },
  ];
  return (
    <nav aria-label="Turnkey sections" className="flex gap-2 flex-wrap" data-testid="tk-staff-nav">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={current === i.key ? 'page' : undefined} data-testid={i.testid}
          className={`min-h-11 px-4 inline-flex items-center rounded-[10px] border ${current === i.key ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:border-ink'}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
