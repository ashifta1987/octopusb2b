'use client';
/**
 * ODS T9 · Customer record › Actions ▾ — ONLY today's customer actions, each calling TODAY's server action unchanged:
 *  - Assign / Reassign account manager → reassignAccountManager (app/admin/customers/actions.ts; admin or assistant:reassign; reason required)
 *  - VIP on / off                      → setVip (company-wide Admin only)
 *  - Pay later eligibility             → setOrgCreditEligibleAction (company-wide Admin only; reason required)
 *  - Services + selling countries      → setService / saveCustomerDropshipMarkets (app/admin/one-app-actions.ts; customers:edit or own AM)
 *  - Customer limits                   → saveCustomerLimits (admin or own AM; confirm, audit-logged)
 *  - Links: KYC review (customers:view), Credit terms (finance:view — propose + decide stay on /admin/finance/credit, two-person),
 *    Assistant queue (assistant:view).
 * The server actions re-check every permission; the menu only hides what today's page hides. `sample` (fixtures) never calls them.
 */
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Gauge, IdCard, Landmark, MessagesSquare, ShieldCheck, ToggleRight, UserCog } from 'lucide-react';
import { Button, Drawer, Field, Input, MenuButton, Select, Switch, Textarea, type MenuButtonItem } from '@octopus/ui';
import { goStepUp } from '@/components/admin/client';
import { reassignAccountManager, setOrgCreditEligibleAction, setVip } from '@/app/admin/customers/actions';
import { saveCustomerDropshipMarkets, saveCustomerLimits, setService } from '@/app/admin/one-app-actions';
import { formatCents } from '../../_lib/customer-logic';
import type { CustomerActionsVM } from '../../_lib/types';

type R = { ok: boolean; error?: string; message?: string; redirect?: string } | void | undefined;
type DrawerId = 'reassign' | 'vip' | 'paylater' | 'services' | 'limits' | null;

const SAMPLE_RESULT = { ok: true, message: 'Sample only: nothing was saved.' } as const;

function useRun(sample: boolean | undefined) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>, onOk?: () => void) => {
    setMsg(null);
    start(async () => {
      const r = sample ? SAMPLE_RESULT : await fn();
      if (r && !r.ok && goStepUp(r as { ok: false; error: string; redirect?: string })) return;
      if (r && !r.ok) {
        setMsg({ ok: false, text: r.error ?? 'Something went wrong. Try again.' });
        return;
      }
      setMsg({ ok: true, text: (r && r.message) || 'Saved.' });
      onOk?.();
      if (!sample) router.refresh();
    });
  };
  return { pending, msg, setMsg, run };
}

function Result({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return (
    <p role="status" aria-live="polite" className={`m-0 min-h-5 text-ods-small ${msg?.ok === false ? 'text-ods-danger' : 'text-ods-success'}`}>
      {msg?.text ?? ''}
    </p>
  );
}

const dollars = (c: number | null | undefined) => (c == null ? '' : (Number(c) / 100).toFixed(2));

export function CustomerActionsMenu({ vm, sample }: { vm: CustomerActionsVM; sample?: boolean }) {
  const [open, setOpen] = useState<DrawerId>(null);
  const v = vm.visibility;
  const items: MenuButtonItem[] = [];
  if (v.reassign) items.push({ id: 'reassign', label: vm.accountManager.current ? 'Reassign account manager' : 'Assign account manager', icon: UserCog, onSelect: () => setOpen('reassign') });
  if (v.services) items.push({ id: 'services', label: 'Services and selling countries', icon: ToggleRight, onSelect: () => setOpen('services') });
  if (v.limits) items.push({ id: 'limits', label: 'Customer limits', icon: Gauge, onSelect: () => setOpen('limits') });
  if (v.vip) items.push({ id: 'vip', label: vm.vip ? 'Remove VIP flag' : 'Mark as VIP', icon: Crown, onSelect: () => setOpen('vip') });
  if (v.payLater) items.push({ id: 'paylater', label: 'Pay later eligibility', icon: Landmark, onSelect: () => setOpen('paylater') });
  if (vm.kycHref) items.push({ id: 'kyc', label: 'KYC review', icon: IdCard, href: vm.kycHref, separatorBefore: items.length > 0 });
  if (v.creditTerms) items.push({ id: 'credit', label: 'Credit terms (Finance)', icon: ShieldCheck, href: '/admin/finance/credit', description: 'Propose here; a second Finance user approves' });
  if (vm.assistantHref) items.push({ id: 'assistant', label: 'Assistant queue', icon: MessagesSquare, href: vm.assistantHref });
  if (!items.length) items.push({ id: 'none', label: 'No actions', disabled: true, disabledReason: 'Your role has no actions on this customer.' });

  return (
    <>
      <MenuButton label="Actions" items={items} align="end" menuLabel="Customer actions" triggerClassName="inline-flex h-ods-control items-center gap-1.5 rounded-ods-control border border-ods-line-strong bg-ods-surface px-3 text-ods-body font-semibold text-ods-navy hover:bg-ods-canvas" testId="customer-actions" />
      {v.reassign ? <ReassignDrawer vm={vm} open={open === 'reassign'} onClose={() => setOpen(null)} sample={sample} /> : null}
      {v.vip ? <VipDrawer vm={vm} open={open === 'vip'} onClose={() => setOpen(null)} sample={sample} /> : null}
      {v.payLater ? <PayLaterDrawer vm={vm} open={open === 'paylater'} onClose={() => setOpen(null)} sample={sample} /> : null}
      {v.services ? <ServicesDrawer vm={vm} open={open === 'services'} onClose={() => setOpen(null)} sample={sample} /> : null}
      {v.limits ? <LimitsDrawer vm={vm} open={open === 'limits'} onClose={() => setOpen(null)} sample={sample} /> : null}
    </>
  );
}

type DrawerProps = { vm: CustomerActionsVM; open: boolean; onClose: () => void; sample?: boolean };

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

function ReassignDrawer({ vm, open, onClose, sample }: DrawerProps) {
  const am = vm.accountManager;
  const [staff, setStaff] = useState('');
  const [reason, setReason] = useState('');
  const { pending, msg, run } = useRun(sample);
  const path = `/admin/customers/${vm.orgId}`;
  const submit = () => run(() => reassignAccountManager(vm.orgId, staff, reason, path), () => { setStaff(''); setReason(''); });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={am.current ? 'Reassign account manager' : 'Assign account manager'}
      description={vm.orgName}
      dirty={!!(staff || reason) && !msg?.ok}
      onSave={submit}
      data-testid="drawer-reassign"
      footer={<Footer><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={pending} loadingText="Saving…" disabled={!staff || !reason.trim()} disabledReason={!staff ? 'Choose a staff member' : !reason.trim() ? 'Write a reason' : undefined}>{am.current ? 'Reassign' : 'Assign'}</Button></Footer>}
    >
      <div className="grid gap-4">
        <Field label="New account manager" required>
          <Select value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="Choose staff…">
            {am.candidates.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === am.current?.id}>
                {c.name}{c.team ? ` · ${c.team}` : ''} · {c.customers}/{am.cap}{c.customers >= am.cap ? ' (at cap)' : ''}{c.outOfOffice ? ' · out of office' : ''}{c.id === am.current?.id ? ' · current' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {am.candidates.length === 0 ? <p className="m-0 text-ods-small text-ods-danger">No staff with the Assistant permission or Sourcing agent role.</p> : null}
        <Field label="Reason" required hint="Logged in the audit trail. The customer sees the new name on their account team card.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Customer prefers a German-speaking manager" />
        </Field>
        <Result msg={msg} />
      </div>
    </Drawer>
  );
}

function VipDrawer({ vm, open, onClose, sample }: DrawerProps) {
  const [on, setOn] = useState(vm.vip);
  const { pending, msg, run } = useRun(sample);
  return (
    <Drawer open={open} onClose={onClose} title="VIP customer" description={vm.orgName} data-testid="drawer-vip" footer={<Footer><Button variant="secondary" onClick={onClose}>Close</Button></Footer>}>
      <div className="grid gap-4">
        <p className="m-0 text-ods-body text-ods-slate">VIP customers are always routed to their human account manager. Admin only.</p>
        <Switch label="VIP customer" checked={on} loading={pending} onCheckedChange={(next) => run(() => setVip(vm.orgId, next), () => setOn(next))} />
        <Result msg={msg} />
      </div>
    </Drawer>
  );
}

function PayLaterDrawer({ vm, open, onClose, sample }: DrawerProps) {
  const [eligible, setEligible] = useState(vm.creditEligible);
  const [reason, setReason] = useState('');
  const { pending, msg, setMsg, run } = useRun(sample);
  const change = (next: boolean) => {
    if (!reason.trim()) {
      setMsg({ ok: false, text: 'Enter a reason before changing Pay-later credit eligibility.' });
      return;
    }
    run(() => setOrgCreditEligibleAction(vm.orgId, next, reason), () => { setEligible(next); setReason(''); });
  };
  return (
    <Drawer open={open} onClose={onClose} title="Pay later credit eligibility" description={vm.orgName} dirty={!!reason} data-testid="drawer-paylater" footer={<Footer><Button variant="secondary" onClick={onClose}>Close</Button></Footer>}>
      <div className="grid gap-4">
        <p className="m-0 text-ods-body text-ods-slate">Controls whether this organisation may be assigned Pay-later credit terms. Company-wide Admin only. Credit limits themselves are proposed and approved by two Finance users on Credit terms.</p>
        <Field label="Reason" required hint="Required for every change. Written to the audit log.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </Field>
        <Switch label="Eligible for Pay later" checked={eligible} loading={pending} onCheckedChange={change} />
        <Result msg={msg} />
      </div>
    </Drawer>
  );
}

function ServicesDrawer({ vm, open, onClose, sample }: DrawerProps) {
  const { pending, msg, run } = useRun(sample);
  const onService = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => setService(vm.orgId, fd));
  };
  const onMarkets = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveCustomerDropshipMarkets(vm.orgId, fd));
  };
  return (
    <Drawer open={open} onClose={onClose} title="Services and selling countries" description={vm.orgName} width={460} data-testid="drawer-services" footer={<Footer><Button variant="secondary" onClick={onClose}>Close</Button></Footer>}>
      <div className="grid gap-3">
        {vm.services.map((s) => (
          <form key={s.service} onSubmit={onService} className="grid gap-2 rounded-ods-control border border-ods-line p-3" aria-label={s.label}>
            <input type="hidden" name="service" value={s.service} />
            <div className="grid grid-cols-2 gap-2">
              <Field label={s.label}>
                <Select name="status" defaultValue={s.status}>
                  <option value="off">Off</option>
                  {s.service !== 'dropship' ? <option value="trial">Trial</option> : null}
                  <option value="on">On</option>
                  <option value="paused">Paused</option>
                </Select>
              </Field>
              <Field label="Plan" optional>
                <Input name="plan" defaultValue={s.plan} placeholder="e.g. Growth" />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-ods-small text-ods-slate">{s.updatedAt ? `Changed ${s.updatedAt.slice(0, 10)}` : 'Never set'}</span>
              <Button type="submit" size="sm" variant="secondary" loading={pending}>Save</Button>
            </div>
          </form>
        ))}
        <form onSubmit={onMarkets} className="grid gap-2 rounded-ods-control border border-ods-line p-3" aria-label="Dropshipping selling countries">
          <Field label="Dropshipping selling countries (ISO-2)" hint="Comma separated, e.g. AE, SA, GB">
            <Input name="countries" defaultValue={vm.dropshipMarkets.countries.join(', ')} placeholder="AE, SA, GB" data-testid="am-dropship-markets" />
          </Field>
          <label className="inline-flex items-center gap-2 text-ods-small text-ods-text">
            <input type="checkbox" name="locked_by_staff" defaultChecked={vm.dropshipMarkets.locked} className="size-4 accent-[var(--ods-navy)]" />
            Lock selling countries (merchant cannot change them)
          </label>
          <div className="flex justify-end"><Button type="submit" size="sm" variant="secondary" loading={pending}>Save selling countries</Button></div>
        </form>
        <Result msg={msg} />
      </div>
    </Drawer>
  );
}

function LimitsDrawer({ vm, open, onClose, sample }: DrawerProps) {
  const l = vm.limits;
  const { pending, msg, run } = useRun(sample);
  const [confirming, setConfirming] = useState<FormData | null>(null);
  const blocked = l.ownCeiling === 'none';
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setConfirming(new FormData(e.currentTarget));
  };
  return (
    <Drawer open={open} onClose={onClose} title="Customer limits" description={vm.orgName} data-testid="drawer-limits" footer={<Footer><Button variant="secondary" onClick={onClose}>Close</Button></Footer>}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <p className="m-0 text-ods-body text-ods-slate">Inside these limits prices are approved automatically. Above them they come to the account manager; above the manager&apos;s own limit, to the owner.</p>
        {l.ownCeiling && l.ownCeiling !== 'none' ? <p className="m-0 text-ods-small">Your own limit: <b>{formatCents(l.ownCeiling.maxAmountCents)}</b>, minimum margin <b>{l.ownCeiling.minMarginPct}%</b>.</p> : null}
        {blocked ? <p className="m-0 rounded-ods-control bg-ods-warning-tint p-3 text-ods-small text-ods-warning">The owner has not set your own limit yet, so you cannot set this customer&apos;s limits.</p> : null}
        <Field label="Per order (US$)"><Input name="max_order" inputMode="decimal" defaultValue={dollars(l.maxOrderCents)} className="text-end" /></Field>
        <Field label="Per month (US$)"><Input name="max_month" inputMode="decimal" defaultValue={dollars(l.maxMonthCents)} className="text-end" /></Field>
        <Field label="Minimum margin (%)"><Input name="min_margin" inputMode="decimal" defaultValue={l.minMarginPct ?? ''} className="text-end" /></Field>
        {l.setAt ? <p className="m-0 text-ods-small text-ods-slate">Last changed {l.setAt.slice(0, 10)}</p> : null}
        {confirming ? (
          <div role="alertdialog" aria-label="Confirm customer limits" className="grid gap-2 rounded-ods-control border border-ods-line-strong bg-ods-canvas p-3">
            <p className="m-0 text-ods-body">Save these customer limits? The change is written to the audit log.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button size="sm" loading={pending} onClick={() => { const fd = confirming; run(() => saveCustomerLimits(vm.orgId, fd), () => setConfirming(null)); }}>Save limits</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end"><Button type="submit">Save limits</Button></div>
        )}
        <Result msg={msg} />
      </form>
    </Drawer>
  );
}
