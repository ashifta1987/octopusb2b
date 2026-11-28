'use client';

import { kycMessageRequiredText } from '@/lib/kyc-message';
import { KycQueue } from '@/app/ods/office/kyc/_components/kyc-queue';
import { KycReview, type KycDecideFn } from '@/app/ods/office/kyc/_components/kyc-review';
import { SupplierReview } from '@/app/ods/office/kyc/_components/supplier-review';
import { kycDecisionState, supplierDecisionState, type KycTab } from '@/app/ods/office/kyc/_lib/kyc-core';
import { SalesPageHead } from '@/app/ods/office/_components/sales-bits';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { KYC_FIXTURE_STATES, type KycFixtureState, SAMPLE_COMPANY, SAMPLE_DOCS, SAMPLE_HISTORY, SAMPLE_HISTORY_MORE_INFO, SAMPLE_KYC_ROWS, SAMPLE_NOW, SAMPLE_SUPPLIER_ROWS } from './sample-data';


const BASE = '/dev/ui/screens/office-kyc';
const wait = () => new Promise((r) => setTimeout(r, 250));

/** Sample decide: the same results reviewKyc returns (message required for reject / more info; ok otherwise). */
const sampleDecide: KycDecideFn = async (to, input) => {
  await wait();
  if ((to === 'rejected' || to === 'more_info') && !input.customerMessage.trim()) return { ok: false, error: kycMessageRequiredText(to) };
  return { ok: true, message: 'KYC updated' };
};
const sampleOk = async () => { await wait(); return { ok: true, message: 'Review started' }; };

export function KycFixture({ state }: { state: KycFixtureState }) {
  const isRecord = ['review', 'more-info', 'locked', 'view-only', 'verified', 'supplier', 'supplier-second'].includes(state);
  const role = state === 'view-only' ? 'finance' : 'sales';
  return (
    <OfficeScreenFrame pathname="/office/kyc" role={role}>
      <FixtureStates label="Fixture states (sample data)" links={KYC_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {isRecord ? <Record state={state} /> : <Queue state={state} />}
    </OfficeScreenFrame>
  );
}

function Queue({ state }: { state: KycFixtureState }) {
  const tab: KycTab = state === 'suppliers' ? 'suppliers' : 'open';
  const none = state === 'empty' || state === 'error' || state === 'loading';
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead crumbs={[{ label: 'Sales' }, { label: 'KYC review' }]} title="KYC review" subtitle="Customer company verification and supplier applications. Documents open only with a fresh 2-step code; every view is logged." />
      <KycQueue
        tab={tab}
        raw={null}
        rows={none ? [] : SAMPLE_KYC_ROWS}
        supplierRows={none ? [] : SAMPLE_SUPPLIER_ROWS}
        canViewSuppliers
        base={`${BASE}?state=${state}`}
        nowIso={SAMPLE_NOW}
        loading={state === 'loading'}
        error={state === 'error' ? 'sample error' : null}
        sample
      />
    </div>
  );
}

function Record({ state }: { state: KycFixtureState }) {
  if (state === 'supplier' || state === 'supplier-second') {
    const second = state === 'supplier-second';
    return (
      <SupplierReview
        reference="SUP-0139"
        company="Shenzhen Lumen Lighting"
        subtitle="Shenzhen, Guangdong · submitted 21 Nov 2026"
        status="in_review"
        rows={[['Reference', 'SUP-0139'], ['USCC', '91440300MA5F000000'], ['City', 'Shenzhen'], ['Province', 'Guangdong'], ['Categories', 'Lighting'], ['Contact', 'Chen Wei'], ['Email', 'export@lumen.example'], ['Phone', '+86 755 0000 0000'], ['WeChat', 'lumen_export'], ['Applied from', 'CN']]}
        links={[['Website', 'lumen.example'], ['1688 / Alibaba store', null]]}
        notes="Factory audit booked for 3 Dec."
        sheet={{ name: 'lumen-catalogue-2026.pdf', url: 'https://sample.supabase.co/storage/v1/object/sign/supplier-applications/sample/lumen.pdf?token=sample-token-60s' }}
        checks={[{ key: 'uscc', ok: true, label: 'USCC format is valid' }, { key: 'dup', ok: true, label: 'No other application with this USCC' }, { key: 'store', ok: false, label: 'No 1688 / Alibaba store link' }]}
        decision={supplierDecisionState({ status: 'in_review', canApprove: true, firstBy: 'u-first', userId: second ? 'u-first' : 'me', firstName: 'Lena Fischer' })}
        lastNote={null}
        decide={async (to, note) => { await wait(); return to === 'rejected' && !note.trim() ? { ok: false, error: 'Add a reason for the rejection.' } : { ok: true, message: 'Application approved by two people. Create the supplier in Admin → Suppliers.' }; }}
        queueHref={`${BASE}?state=suppliers`}
        sample
      />
    );
  }
  const status = state === 'more-info' ? 'more_info' : state === 'verified' ? 'verified' : 'in_review';
  return (
    <KycReview
      title="Casa Verde SA"
      account="Casa Verde SA"
      subtitle="Retailer · Madrid, Spain · submitted 22 Nov 2026, 14:30"
      status={status}
      companyStatus={status === 'verified' ? 'Verified' : 'Verification pending'}
      company={SAMPLE_COMPANY}
      docs={SAMPLE_DOCS(state !== 'locked')}
      docsState={state === 'locked' ? 'locked' : 'unlocked'}
      stepUpHref="/staff/verify?next=%2Foffice%2Fkyc%2Fsample&reason=step_up"
      decision={kycDecisionState(status, state !== 'view-only')}
      lastCustomerMessage={state === 'more-info' ? 'Please upload a proof of address dated in the last 3 months.' : null}
      lastInternalNote={state === 'more-info' ? 'Utility bill is from June.' : null}
      history={state === 'more-info' ? SAMPLE_HISTORY_MORE_INFO : SAMPLE_HISTORY}
      startReview={sampleOk}
      decide={sampleDecide}
      queueHref={`${BASE}?state=queue`}
      sample
    />
  );
}
