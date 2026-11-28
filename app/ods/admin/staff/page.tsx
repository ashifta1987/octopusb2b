// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireStaff } from '@/lib/auth';
import { StaffSecurityForm } from '@/components/admin/staff-security';
import {
  addToDivisions, assignSupplier, createStaffWithoutEmail, endSessions, inviteStaff, removeFromDivision, resendInvite, resetTwoFactor, savePermissions,
  saveStaffSecurity, setStaffActive, setUserRoles, unassignSupplier, unlockAccount,
} from '@/app/admin/staff/actions';
import { loadStaff } from '@/app/ods/office/_lib/admin-c-data';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { StaffAdmin } from '@/app/ods/office/_components/admin-c-staff';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/**
 * ODS T9 · /admin/staff — Staff & roles. Guard as today: requireStaff('staff', 'view', '/admin/staff'). Same reads
 * (admin_staff_security, roles, permissions, divisions, distributor assignments; Security panel + auth events for
 * admins only). Every change = TODAY's action (app/admin/staff/actions.ts) with its own guard, the fresh-2FA step-up for
 * role / permission / division / invite changes, admin-only rules (admin role, reset 2FA, advanced create) and audit.
 * The Security settings form is today's StaffSecurityForm (saveStaffSecurity), shown inside the ODS panel.
 */
export const metadata: Metadata = { title: 'Staff & roles' };

type SP = Promise<{ role?: string; user?: string }>;

export default function OdsStaffPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Staff & roles" testId="staff-page" lines={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('staff', 'view', '/admin/staff');
  const sp = await searchParams;
  const r = await settle(() => loadStaff(s, sp.role));
  if (!r.ok) return <ErrorPage title="Staff & roles" />;
  return (
    <StaffAdmin
      data={r.data}
      initialUser={sp.user ?? null}
      securityForm={s.isAdmin ? <StaffSecurityForm settings={r.data.security} action={saveStaffSecurity} /> : null}
      actions={{
        inviteStaff, createStaffWithoutEmail, setUserRoles, savePermissions, addToDivisions, assignSupplier, saveStaffSecurity,
        resendInvite, resetTwoFactor, endSessions, unlockAccount, setStaffActive, unassignSupplier, removeFromDivision,
      }}
    />
  );
}
