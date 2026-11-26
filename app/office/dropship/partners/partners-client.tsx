'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsSelect, DsTableCard, DsTextarea } from '@/components/dropship-ui';
import { PARTNER_KIND, PARTNER_STATUS, fmtDay, ruleText, usd, type PartnerRule } from '@/lib/dropship-ds14-shared';
import type { PartnersPage } from '@/lib/dropship-ds14';
import { attachMerchantAction, invitePartnerAction, saveRuleAction, setPartnerStatusAction } from '../ds14-actions';

type RuleForm = { kind: 'percent_of_plan_fee' | 'fixed_per_merchant'; percent: string; fixed: string; months: string };
const toForm = (r: PartnerRule | null): RuleForm => ({ kind: r?.kind ?? 'percent_of_plan_fee', percent: r?.rate_bps != null ? String(r.rate_bps / 100) : '', fixed: r?.fixed_cents != null ? (r.fixed_cents / 100).toFixed(2) : '', months: r ? String(r.months) : '' });

export function PartnersClient({ data }: { data: PartnersPage }) {
  const router = useRouter();
  const [inv, setInv] = useState({ name: '', kind: 'agency', contact_name: '', contact_email: '', note: '' });
  const [rule, setRule] = useState<RuleForm>(toForm(data.default_rule));
  const [rulePartner, setRulePartner] = useState('');
  const [attachP, setAttachP] = useState(data.partners.find((p) => p.status !== 'ended')?.id ?? '');
  const [attachM, setAttachM] = useState(data.available_merchants[0]?.id ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const done = (r: { ok: boolean; message?: string }, okText: string) => { setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.message ?? 'Could not save.' }); if (r.ok) router.refresh(); };
  const totalEarned = data.partners.reduce((s, p) => s + p.earned_cents, 0);
  const pickRulePartner = (id: string) => { setRulePartner(id); setRule(toForm(id ? (data.partners.find((p) => p.id === id)?.rule ?? null) : data.default_rule)); };

  return (
    <div className="flex flex-col gap-5" data-testid="staff-partners-page">
      <DsPageHeader title="Sales partners" subtitle="Invite partners, track the merchants they bring and the commission they earn." icon="users" />
      {!data.plan_fees_on && (
        <DsNotice tone="info" title="Commission does not apply yet" testId="partners-fees-off">
          Plan fees are switched off, so merchants are not charged a plan fee and no commission accrues. Partners and rules can be set up now; commission starts when plan fees are switched on in Finance › SaaS billing. Earned stays {usd(totalEarned)} until then.
        </DsNotice>
      )}
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'Done' : 'Could not do that'} testId="partners-msg">{msg.text}</DsNotice>}

      {data.partners.length === 0 ? (
        <DsEmptyState title="No sales partners yet" description="Invite a partner below. Partners have no login: staff manage them here." icon="users" />
      ) : (
        <DsTableCard title="Sales partners" subtitle="People and companies who bring merchants to Octopus Dropship" headers={['Partner', 'Type', 'Merchants', 'Commission earned', 'Rule', 'Status', '']} minWidth={860} testId="partners-table">
          {data.partners.map((p) => {
            const st = PARTNER_STATUS[p.status];
            return (
              <tr key={p.id} data-testid="partner-row">
                <td className="font-semibold">{p.name}<div className="text-[12px] text-[#5B6478] font-normal">{p.code} · {p.contact_email}</div></td>
                <td>{PARTNER_KIND[p.kind]}</td><td>{p.merchants}</td><td>{usd(p.earned_cents)}</td>
                <td className="text-[13px]">{ruleText(p.rule ?? data.default_rule)}{!p.rule && data.default_rule ? ' (default)' : ''}</td>
                <td><DsBadge tone={st.tone}>{st.label}</DsBadge></td>
                <td>{data.can_edit && p.status !== 'ended' && (
                  <div className="flex gap-2 flex-wrap">
                    {p.status !== 'active' && <DsButton variant="secondary" onClick={() => start(async () => done(await setPartnerStatusAction(p.id, 'active'), `${p.name} is active.`))} loading={pending} aria-label={`Activate ${p.name}`}>Activate</DsButton>}
                    {p.status === 'active' && <DsButton variant="secondary" onClick={() => start(async () => done(await setPartnerStatusAction(p.id, 'paused'), `${p.name} is paused.`))} loading={pending} aria-label={`Pause ${p.name}`}>Pause</DsButton>}
                    <DsButton variant="danger" onClick={() => start(async () => done(await setPartnerStatusAction(p.id, 'ended'), `${p.name} has ended.`))} loading={pending} aria-label={`End ${p.name}`}>End</DsButton>
                  </div>)}</td>
              </tr>
            );
          })}
        </DsTableCard>
      )}

      {data.merchants.length > 0 && (
        <DsTableCard title="Merchants brought" headers={['Merchant', 'Partner', 'Since', 'Commission earned']} minWidth={560} testId="partner-merchants">
          {data.merchants.map((m) => <tr key={m.org_id}><td className="font-semibold">{m.name}</td><td>{data.partners.find((p) => p.id === m.partner_id)?.name ?? '—'}</td><td>{fmtDay(m.attached_at)}</td><td>{usd(m.earned_cents)}</td></tr>)}
        </DsTableCard>
      )}

      {data.can_edit && (
        <div className="grid lg:grid-cols-2 gap-5">
          <DsCard title="Invite partner" icon="plus" testId="partner-invite">
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await invitePartnerAction(inv); done(r, r.ok ? `${r.data.code} created. Activate the partner when the agreement is signed.` : ''); if (r.ok) setInv({ name: '', kind: 'agency', contact_name: '', contact_email: '', note: '' }); }); }}>
              <DsInput label="Partner name" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} required />
              <DsSelect label="Type" value={inv.kind} onChange={(e) => setInv({ ...inv, kind: e.target.value })}>{Object.entries(PARTNER_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</DsSelect>
              <DsInput label="Contact name" value={inv.contact_name} onChange={(e) => setInv({ ...inv, contact_name: e.target.value })} />
              <DsInput label="Contact email" type="email" value={inv.contact_email} onChange={(e) => setInv({ ...inv, contact_email: e.target.value })} required />
              <DsTextarea label="Note (internal)" value={inv.note} onChange={(e) => setInv({ ...inv, note: e.target.value })} rows={2} />
              <div><DsButton type="submit" loading={pending} icon="send">Invite partner</DsButton></div>
            </form>
            <p className="text-[12px] text-[#5B6478] mt-3 mb-0">An invite records the partner here. No email is sent and the partner has no login yet (not designed).</p>
          </DsCard>
          <DsCard title="Attach a merchant" icon="link" testId="partner-attach">
            {data.partners.length === 0 || data.available_merchants.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">{data.partners.length === 0 ? 'Invite a partner first.' : 'Every merchant with Dropship already belongs to a partner.'}</p> : (
              <div className="grid gap-3">
                <DsSelect label="Partner" value={attachP} onChange={(e) => setAttachP(e.target.value)}>{data.partners.filter((p) => p.status !== 'ended').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</DsSelect>
                <DsSelect label="Merchant" value={attachM} onChange={(e) => setAttachM(e.target.value)}>{data.available_merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</DsSelect>
                <div><DsButton onClick={() => start(async () => done(await attachMerchantAction(attachP, attachM), 'Merchant attached. Commission counts plan fees charged from now on.'))} loading={pending}>Attach merchant</DsButton></div>
              </div>
            )}
            <p className="text-[12px] text-[#5B6478] mt-3 mb-0">Only plan fees charged after the merchant is attached earn commission. A merchant belongs to one partner.</p>
          </DsCard>
        </div>
      )}

      <DsCard title="Commission rules" subtitle="Commission is calculated on plan fees the merchant actually paid. Rates and tax treatment are to be confirmed by management and your accountant." icon="percent" testId="partner-rules">
        {!data.can_rules ? <p className="m-0 text-[14px] text-[#5B6478]">Only Finance approvers and admins change commission rules. Current default: {ruleText(data.default_rule)}.</p> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <DsSelect label="Applies to" value={rulePartner} onChange={(e) => pickRulePartner(e.target.value)}><option value="">Default for all partners</option>{data.partners.filter((p) => p.status !== 'ended').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</DsSelect>
            <DsSelect label="Commission type" value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value as RuleForm['kind'] })}><option value="percent_of_plan_fee">Percent of plan fee</option><option value="fixed_per_merchant">Fixed per merchant</option></DsSelect>
            {rule.kind === 'percent_of_plan_fee'
              ? <DsInput label="Rate (%)" inputMode="decimal" value={rule.percent} onChange={(e) => setRule({ ...rule, percent: e.target.value })} />
              : <DsInput label="Amount per month (USD)" inputMode="decimal" value={rule.fixed} onChange={(e) => setRule({ ...rule, fixed: e.target.value })} />}
            <DsInput label="Paid for how many months" inputMode="numeric" value={rule.months} onChange={(e) => setRule({ ...rule, months: e.target.value })} hint="Payout: monthly. Payouts are not built yet." />
            <div><DsButton onClick={() => start(async () => done(await saveRuleAction(rulePartner || null, rule), 'Rule saved.'))} loading={pending}>Save rules</DsButton></div>
          </div>
        )}
      </DsCard>
    </div>
  );
}
