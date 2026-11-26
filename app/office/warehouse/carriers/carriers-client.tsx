'use client';

import { useMemo, useState } from 'react';
import { DsBadge, DsButton, DsCard, DsCheckbox, DsInput, DsSelect, DsTextarea } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABEL, parseCountries, pickService, ruleText, type ProductType, type RuleDraft, type ServiceForRules } from '@/lib/carriers/rules';
import {
  CARRIERS, CARRIER_LABEL, LEVELS, LEVEL_LABEL, VERSION_STATUS, grams,
  type CarrierAccount, type CarriersBoard, type CarrierStation, type RuleVersion,
} from '@/lib/warehouse-w4';
import { decideRulesAction, proposeRulesAction, saveCarrierAccountAction, saveCarrierServiceAction, type RuleInput } from '../w4-actions';
import { MsgLine, useRun } from '../wh-run';

/** Warehouse OS · W4 board 9 — accounts, services, rule versions (propose / approve by a different admin), try the rules. */
export function CarriersClient({ board, credentials }: { board: CarriersBoard; credentials: Record<string, boolean> }) {
  if (board.stations.length === 0) return <DsCard><p className="m-0 text-[13.5px] text-[#5B6478]">You don’t work at a warehouse here.</p></DsCard>;
  return (
    <div className="flex flex-col gap-8">
      {board.stations.map((st) => <Station key={st.warehouse_code} st={st} me={board.me} staging={board.staging} credentials={credentials} multi={board.stations.length > 1} />)}
    </div>
  );
}

function servicesOf(st: CarrierStation): ServiceForRules[] {
  return st.accounts.flatMap((a) => a.services.map((s) => ({
    id: s.id, name: `${s.name} (${CARRIER_LABEL[a.carrier]})`, active: s.active, accountActive: a.active, accountName: a.name, sandbox: a.mode === 'sandbox',
    accepts_battery: s.accepts_battery, accepts_liquid: s.accepts_liquid, max_weight_g: s.max_weight_g,
  })));
}

function Station({ st, me, staging, credentials, multi }: { st: CarrierStation; me: string; staging: boolean; credentials: Record<string, boolean>; multi: boolean }) {
  const services = useMemo(() => servicesOf(st), [st]);
  const wh = st.warehouse_code;
  return (
    <section className="flex flex-col gap-5" aria-label={`${st.name} carriers`} data-testid={`wh-carriers-${wh}`}>
      {multi && <h2 className="m-0 text-[20px] font-bold">{st.name} <span className="text-[#5B6478] font-normal text-[15px]">· {wh}</span></h2>}
      <Accounts st={st} staging={staging} credentials={credentials} />
      <ActiveRules st={st} services={services} staging={staging} />
      {st.pending && <Pending v={st.pending} me={me} canDecide={st.can_manage} wh={wh} />}
      {st.can_manage && !st.pending && <Propose st={st} services={services} staging={staging} />}
      {st.history.length > 0 && <History versions={st.history} wh={wh} />}
    </section>
  );
}

// ───────── accounts and services ─────────
function Accounts({ st, staging, credentials }: { st: CarrierStation; staging: boolean; credentials: Record<string, boolean> }) {
  const wh = st.warehouse_code;
  const { pending, msg, run } = useRun();
  const [f, setF] = useState({ carrier: '4px', name: '', mode: staging ? 'sandbox' : 'live', env: '' });
  const why = !f.name.trim() ? 'Give the account a name' : f.mode === 'live' && !f.env.trim() ? 'Name the server setting that holds the live credentials' : undefined;
  return (
    <DsCard title="Carrier accounts" icon="truck" testId={`wh-accounts-${wh}`}
      subtitle="Credentials never go in the database: a live account names the server setting that holds them. Sandbox accounts make clearly marked test labels and work on staging only.">
      {st.accounts.length === 0 ? <p className="m-0 text-[13.5px] text-[#5B6478]">No carrier account yet.</p> : (
        <ul className="list-none m-0 p-0 flex flex-col gap-3">
          {st.accounts.map((a) => <AccountRow key={a.id} a={a} wh={wh} canManage={st.can_manage} credentialsOk={credentials[a.id] ?? false} staging={staging} />)}
        </ul>
      )}
      {st.can_manage && (
        <form className="mt-4 pt-4 border-t border-[#EEF0F4] flex flex-wrap gap-3 items-end" data-testid={`wh-account-form-${wh}`}
          onSubmit={(e) => { e.preventDefault(); if (!why) run(() => saveCarrierAccountAction({ warehouse: wh, id: null, carrier: f.carrier, name: f.name, mode: f.mode, credentialEnv: f.env, active: true }), () => setF({ ...f, name: '', env: '' })); }}>
          <DsSelect label="Carrier" value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} containerClassName="w-[150px]">
            {CARRIERS.map((c) => <option key={c} value={c}>{CARRIER_LABEL[c]}</option>)}
          </DsSelect>
          <DsInput label="Account name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} containerClassName="w-[220px]" />
          <DsSelect label="Mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} containerClassName="w-[200px]">
            {staging && <option value="sandbox">Sandbox (test labels)</option>}
            <option value="live">Live</option>
          </DsSelect>
          <DsInput label="Credentials setting name" value={f.env} placeholder="FOURPX_FS01" maxLength={41} onChange={(e) => setF({ ...f, env: e.target.value.toUpperCase() })}
            containerClassName="w-[200px]" hint="Prefix of the server settings _APP_KEY and _APP_SECRET" />
          <DsButton type="submit" icon="plus" disabled={pending || Boolean(why)} disabledReason={f.name ? why : undefined} testId={`wh-account-submit-${wh}`}>Add account</DsButton>
          <MsgLine msg={msg} testId={`wh-account-msg-${wh}`} />
        </form>
      )}
    </DsCard>
  );
}

function AccountRow({ a, wh, canManage, credentialsOk, staging }: { a: CarrierAccount; wh: string; canManage: boolean; credentialsOk: boolean; staging: boolean }) {
  const { pending, msg, run } = useRun();
  const [s, setS] = useState({ code: '', name: '', level: 'standard', max: '', battery: false, liquid: false });
  const why = !s.code.trim() ? 'Enter the carrier’s product code' : !s.name.trim() ? 'Name the service' : undefined;
  const toggle = () => run(() => saveCarrierAccountAction({ warehouse: wh, id: a.id, carrier: a.carrier, name: a.name, mode: a.mode, credentialEnv: a.credential_env ?? '', active: !a.active }));
  return (
    <li className="rounded-[10px] border border-[#E3E7EF] p-4 flex flex-col gap-3" data-testid={`wh-account-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{a.name}</span>
        <span className="text-[13px] text-[#5B6478]">{CARRIER_LABEL[a.carrier]}</span>
        {a.mode === 'sandbox' ? <DsBadge tone="warn">Sandbox · test labels only</DsBadge> : <DsBadge tone="info">Live</DsBadge>}
        {!a.active && <DsBadge tone="neutral">Switched off</DsBadge>}
        {a.mode === 'live' && (credentialsOk
          ? <DsBadge tone="ok">Server credentials found</DsBadge>
          : <DsBadge tone="bad">{`Not connected: set ${a.credential_env}_APP_KEY and _APP_SECRET on the server`}</DsBadge>)}
        {a.mode === 'sandbox' && !staging && <DsBadge tone="bad">Sandbox does not work here</DsBadge>}
      </div>
      {a.services.length === 0 ? <p className="m-0 text-[13px] text-[#5B6478]">No services yet.</p> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${a.name} services`}>
          <table className="ds-tbl min-w-[620px]">
            <thead><tr><th scope="col">Service</th><th scope="col">Code</th><th scope="col">Level</th><th scope="col">Up to</th><th scope="col">Batteries</th><th scope="col">Liquids</th><th scope="col">State</th>{canManage && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {a.services.map((x) => (
                <tr key={x.id} data-testid={`wh-service-${x.code}`}>
                  <td>{x.name}</td><td className="font-mono">{x.code}</td><td>{LEVEL_LABEL[x.level]}</td><td>{x.max_weight_g ? grams(x.max_weight_g) : 'Any weight'}</td>
                  <td>{x.accepts_battery ? 'Yes' : 'No'}</td><td>{x.accepts_liquid ? 'Yes' : 'No'}</td>
                  <td>{x.active ? <DsBadge tone="ok">In use</DsBadge> : <DsBadge tone="neutral">Off</DsBadge>}</td>
                  {canManage && (
                    <td><DsButton variant="link" disabled={pending}
                      onClick={() => run(() => saveCarrierServiceAction({ accountId: a.id, id: x.id, code: x.code, name: x.name, level: x.level, maxWeightG: x.max_weight_g ? String(x.max_weight_g) : '', battery: x.accepts_battery, liquid: x.accepts_liquid, active: !x.active }))}>
                      {x.active ? 'Switch off' : 'Switch on'}<span className="sr-only"> {x.name}</span>
                    </DsButton></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <details>
          <summary className="cursor-pointer text-[13.5px] font-semibold text-[#2A6FD1] min-h-[44px] flex items-center">Add a service to {a.name}</summary>
          <form className="mt-2 flex flex-wrap gap-3 items-end" data-testid={`wh-service-form-${a.id}`}
            onSubmit={(e) => { e.preventDefault(); if (!why) run(() => saveCarrierServiceAction({ accountId: a.id, id: null, code: s.code, name: s.name, level: s.level, maxWeightG: s.max, battery: s.battery, liquid: s.liquid, active: true }), () => setS({ code: '', name: '', level: 'standard', max: '', battery: false, liquid: false })); }}>
            <DsInput label="Product code" value={s.code} maxLength={40} onChange={(e) => setS({ ...s, code: e.target.value })} containerClassName="w-[150px]" />
            <DsInput label="Service name" value={s.name} maxLength={80} onChange={(e) => setS({ ...s, name: e.target.value })} containerClassName="w-[200px]" />
            <DsSelect label="Level" value={s.level} onChange={(e) => setS({ ...s, level: e.target.value })} containerClassName="w-[140px]">
              {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </DsSelect>
            <DsInput label="Maximum weight (g)" inputMode="numeric" value={s.max} onChange={(e) => setS({ ...s, max: e.target.value.replace(/\D/g, '').slice(0, 7) })} containerClassName="w-[160px]" />
            <DsCheckbox label="Takes batteries" checked={s.battery} onChange={(e) => setS({ ...s, battery: e.target.checked })} />
            <DsCheckbox label="Takes liquids" checked={s.liquid} onChange={(e) => setS({ ...s, liquid: e.target.checked })} />
            <DsButton type="submit" icon="plus" disabled={pending || Boolean(why)} disabledReason={s.code || s.name ? why : undefined} testId={`wh-service-submit-${a.id}`}>Add service</DsButton>
          </form>
        </details>
      )}
      {canManage && <DsButton variant="link" onClick={toggle} disabled={pending}>{a.active ? 'Switch this account off' : 'Switch this account on'}</DsButton>}
      <MsgLine msg={msg} testId={`wh-account-row-msg-${a.id}`} />
    </li>
  );
}

// ───────── rules ─────────
function RulesTable({ v, label }: { v: RuleVersion; label: string }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="ds-tbl min-w-[640px]">
        <thead><tr><th scope="col">#</th><th scope="col">Countries</th><th scope="col">Product type</th><th scope="col">Weight</th><th scope="col">Service</th></tr></thead>
        <tbody>
          {v.rules.map((r) => (
            <tr key={r.seq}>
              <td className="font-mono">{r.seq}</td><td>{r.countries.length ? r.countries.join(', ') : 'Any country'}</td><td>{PRODUCT_TYPE_LABEL[r.product_type]}</td>
              <td>{r.min_weight_g == null && r.max_weight_g == null ? 'Any weight' : `${r.min_weight_g == null ? '0' : grams(r.min_weight_g)} – ${r.max_weight_g == null ? 'any' : grams(r.max_weight_g)}`}</td>
              <td>{r.service_name} <span className="text-[#5B6478]">· {CARRIER_LABEL[r.carrier]}</span></td>
            </tr>
          ))}
          <tr><td>—</td><td colSpan={3} className="font-semibold">Fallback (nothing above matched or could carry it)</td>
            <td>{v.fallback ? <>{v.fallback.name} <span className="text-[#5B6478]">· {CARRIER_LABEL[v.fallback.carrier]}</span></> : '—'}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function Tester({ rules, fallbackId, services, staging, testId }: { rules: RuleDraft[]; fallbackId: string | null; services: ServiceForRules[]; staging: boolean; testId: string }) {
  const [t, setT] = useState({ country: '', weight: '', battery: false, liquid: false });
  const ready = /^[A-Za-z]{2}$/.test(t.country.trim());
  const res = ready ? pickService({ rules, fallbackId, services, country: t.country, dg: [...(t.battery ? ['battery'] : []), ...(t.liquid ? ['liquid'] : [])], weightG: t.weight ? Number(t.weight) : null, staging }) : null;
  return (
    <div className="mt-4 pt-4 border-t border-[#EEF0F4]" data-testid={testId}>
      <h3 className="m-0 text-[14px] font-bold">Try the rules</h3>
      <div className="mt-2 flex flex-wrap gap-3 items-end">
        <DsInput label="Country" value={t.country} maxLength={2} placeholder="DE" onChange={(e) => setT({ ...t, country: e.target.value.toUpperCase() })} containerClassName="w-[110px]" />
        <DsInput label="Weight (g)" inputMode="numeric" value={t.weight} onChange={(e) => setT({ ...t, weight: e.target.value.replace(/\D/g, '').slice(0, 7) })} containerClassName="w-[130px]" />
        <DsCheckbox label="Battery" checked={t.battery} onChange={(e) => setT({ ...t, battery: e.target.checked })} />
        <DsCheckbox label="Liquid" checked={t.liquid} onChange={(e) => setT({ ...t, liquid: e.target.checked })} />
      </div>
      <p role="status" className={`mt-2 mb-0 text-[13.5px] ${res && !res.ok ? 'text-[#B42318]' : 'text-[#1A174A]'}`} data-testid={`${testId}-result`}>
        {res ? res.reason : 'Enter a two-letter country code to see which service a parcel gets.'}
      </p>
    </div>
  );
}

const asDrafts = (v: RuleVersion | null): RuleDraft[] => (v?.rules ?? []).map((r) => ({ seq: r.seq, countries: r.countries, product_type: r.product_type, min_weight_g: r.min_weight_g, max_weight_g: r.max_weight_g, service_id: r.service_id }));

function ActiveRules({ st, services, staging }: { st: CarrierStation; services: ServiceForRules[]; staging: boolean }) {
  const v = st.active;
  return (
    <DsCard title={v ? `Rules in use · version ${v.version}` : 'Rules in use'} icon="globe" testId={`wh-rules-active-${st.warehouse_code}`}
      subtitle={v ? `Proposed by ${v.proposed_by_name ?? 'staff'} ${fmtWh(v.proposed_at)} · approved by ${v.approved_by_name ?? 'an admin'} ${fmtWh(v.approved_at)}${v.note ? ` · ${v.note}` : ''}` : 'The first rule that matches the parcel and whose service can carry it is used; otherwise the fallback.'}>
      {v ? <RulesTable v={v} label={`Rules in use at ${st.name}`} /> : <p className="m-0 text-[13.5px] text-[#5B6478]">No approved rules yet, so parcels can’t be labelled here. A warehouse admin proposes rules below; a different admin approves them.</p>}
      {v && <Tester rules={asDrafts(v)} fallbackId={v.fallback?.id ?? null} services={services} staging={staging} testId={`wh-rules-try-${st.warehouse_code}`} />}
    </DsCard>
  );
}

function Pending({ v, me, canDecide, wh }: { v: RuleVersion; me: string; canDecide: boolean; wh: string }) {
  const { pending, msg, run } = useRun();
  const [reason, setReason] = useState('');
  const mine = v.proposed_by === me;
  return (
    <DsCard title={`Waiting for approval · version ${v.version}`} icon="clock" testId={`wh-rules-pending-${wh}`}
      subtitle={`Proposed by ${v.proposed_by_name ?? 'staff'} ${fmtWh(v.proposed_at)}${v.note ? ` · “${v.note}”` : ''}. Not used until a different admin approves it.`}>
      <RulesTable v={v} label={`Proposed rules version ${v.version}`} />
      {canDecide ? (
        <div className="mt-4 flex flex-wrap gap-3 items-end">
          <DsButton icon="check" disabled={pending || mine} disabledReason={mine ? 'You proposed these rules; a different admin approves them.' : undefined}
            testId={`wh-rules-approve-${wh}`} onClick={() => run(() => decideRulesAction(v.id, 'approve', ''))}>Approve version {v.version}</DsButton>
          <DsInput label="Reason to reject" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} containerClassName="w-[260px]" />
          <DsButton variant="secondary" disabled={pending || !reason.trim()} testId={`wh-rules-reject-${wh}`}
            onClick={() => run(() => decideRulesAction(v.id, 'reject', reason), () => setReason(''))}>{mine ? 'Withdraw' : 'Reject'}</DsButton>
        </div>
      ) : <p className="mt-3 mb-0 text-[13px] text-[#5B6478]">A warehouse admin approves or rejects it.</p>}
      <MsgLine msg={msg} testId={`wh-rules-decide-msg-${wh}`} />
    </DsCard>
  );
}

type Draft = { countries: string; productType: ProductType; minG: string; maxG: string; serviceId: string };
const toDraft = (v: RuleVersion | null): Draft[] => (v?.rules ?? []).map((r) => ({
  countries: r.countries.join(', '), productType: r.product_type, minG: r.min_weight_g == null ? '' : String(r.min_weight_g), maxG: r.max_weight_g == null ? '' : String(r.max_weight_g), serviceId: r.service_id,
}));

function Propose({ st, services, staging }: { st: CarrierStation; services: ServiceForRules[]; staging: boolean }) {
  const wh = st.warehouse_code;
  const usable = services.filter((s) => s.active && s.accountActive);
  const { pending, msg, run } = useRun();
  const [rows, setRows] = useState<Draft[]>(toDraft(st.active));
  const [fallback, setFallback] = useState(st.active?.fallback?.id ?? '');
  const [note, setNote] = useState('');
  const set = (i: number, p: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const x = [...rs]; const [r] = x.splice(i, 1); x.splice(i + d, 0, r); return x; });
  const bad = rows.findIndex((r) => parseCountries(r.countries) === null || !r.serviceId || (r.minG !== '' && r.maxG !== '' && Number(r.minG) > Number(r.maxG)));
  const why = usable.length === 0 ? 'Add a carrier account and a service first' : !fallback ? 'Choose the fallback service'
    : bad >= 0 ? `Rule ${bad + 1}: check the countries (two letters, commas), weights and service` : undefined;
  const drafts: RuleDraft[] = rows.map((r, i) => ({ seq: i + 1, countries: parseCountries(r.countries) ?? [], product_type: r.productType, min_weight_g: r.minG === '' ? null : Number(r.minG), max_weight_g: r.maxG === '' ? null : Number(r.maxG), service_id: r.serviceId }));
  return (
    <DsCard title="Propose new rules" icon="pencil" testId={`wh-rules-editor-${wh}`}
      subtitle="Rules are checked top to bottom. Leave countries empty for any country and weights empty for any weight. Product type comes from the dangerous goods in the parcel.">
      {rows.length === 0 && <p className="m-0 mb-3 text-[13.5px] text-[#5B6478]">No rules yet — with only a fallback, every parcel gets the fallback service.</p>}
      <ol className="list-none m-0 p-0 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={i} className="rounded-[10px] border border-[#E3E7EF] p-3 flex flex-wrap gap-3 items-end" data-testid={`wh-rule-row-${wh}-${i + 1}`}>
            <span className="font-mono font-semibold min-h-[44px] flex items-center" aria-hidden="true">{i + 1}</span>
            <DsInput label={`Rule ${i + 1} countries`} value={r.countries} placeholder="Any country" onChange={(e) => set(i, { countries: e.target.value.toUpperCase() })} containerClassName="w-[180px]" />
            <DsSelect label={`Rule ${i + 1} product type`} value={r.productType} onChange={(e) => set(i, { productType: e.target.value as ProductType })} containerClassName="w-[190px]">
              {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{PRODUCT_TYPE_LABEL[p]}</option>)}
            </DsSelect>
            <DsInput label={`Rule ${i + 1} from (g)`} inputMode="numeric" value={r.minG} onChange={(e) => set(i, { minG: e.target.value.replace(/\D/g, '').slice(0, 7) })} containerClassName="w-[120px]" />
            <DsInput label={`Rule ${i + 1} up to (g)`} inputMode="numeric" value={r.maxG} onChange={(e) => set(i, { maxG: e.target.value.replace(/\D/g, '').slice(0, 7) })} containerClassName="w-[120px]" />
            <DsSelect label={`Rule ${i + 1} service`} value={r.serviceId} onChange={(e) => set(i, { serviceId: e.target.value })} containerClassName="w-[240px]">
              <option value="">Choose a service</option>
              {usable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </DsSelect>
            <div className="flex gap-1">
              <DsButton variant="secondary" disabled={i === 0} onClick={() => move(i, -1)}>Up<span className="sr-only"> rule {i + 1}</span></DsButton>
              <DsButton variant="secondary" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Down<span className="sr-only"> rule {i + 1}</span></DsButton>
              <DsButton variant="secondary" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove<span className="sr-only"> rule {i + 1}</span></DsButton>
            </div>
            {parseCountries(r.countries) && <span className="basis-full text-[12.5px] text-[#5B6478]">{ruleText(parseCountries(r.countries)!, r.productType, r.minG === '' ? null : Number(r.minG), r.maxG === '' ? null : Number(r.maxG))}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-3 items-end">
        <DsButton variant="secondary" icon="plus" disabled={rows.length >= 50} testId={`wh-rule-add-${wh}`}
          onClick={() => setRows((rs) => [...rs, { countries: '', productType: 'any', minG: '', maxG: '', serviceId: '' }])}>Add a rule</DsButton>
        <DsSelect label="Fallback service" value={fallback} onChange={(e) => setFallback(e.target.value)} containerClassName="w-[260px]">
          <option value="">Choose the fallback</option>
          {usable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </DsSelect>
      </div>
      <DsTextarea label="Note for the approver" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} containerClassName="mt-3 max-w-[640px]" />
      <Tester rules={drafts} fallbackId={fallback || null} services={services} staging={staging} testId={`wh-rules-preview-${wh}`} />
      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <DsButton icon="send" disabled={pending || Boolean(why)} disabledReason={why} testId={`wh-rules-propose-${wh}`}
          onClick={() => run(() => proposeRulesAction({ warehouse: wh, rules: rows.map<RuleInput>((r) => ({ countries: r.countries, productType: r.productType, minG: r.minG, maxG: r.maxG, serviceId: r.serviceId })), fallbackId: fallback, note }), () => setNote(''))}>
          Propose for approval
        </DsButton>
        <MsgLine msg={msg} testId={`wh-rules-msg-${wh}`} />
      </div>
    </DsCard>
  );
}

function History({ versions, wh }: { versions: RuleVersion[]; wh: string }) {
  return (
    <DsCard title="Earlier versions" icon="clock" noPadding testId={`wh-rules-history-${wh}`}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Earlier carrier rule versions">
        <table className="ds-tbl min-w-[620px]">
          <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Rules</th><th scope="col">Proposed</th><th scope="col">Decided</th></tr></thead>
          <tbody>
            {versions.map((v) => {
              const [label, tone] = VERSION_STATUS[v.status];
              return (
                <tr key={v.id}>
                  <td className="font-mono">v{v.version}</td>
                  <td><DsBadge tone={tone}>{label}</DsBadge>{v.reject_reason ? <span className="block text-[12.5px] text-[#5B6478]">{v.reject_reason}</span> : null}</td>
                  <td>{v.rules.length} + fallback {v.fallback?.name ?? ''}</td>
                  <td>{v.proposed_by_name ?? 'staff'} · {fmtWh(v.proposed_at)}</td>
                  <td>{v.approved_by_name ?? v.rejected_by_name ?? '—'} · {fmtWh(v.decided_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DsCard>
  );
}
