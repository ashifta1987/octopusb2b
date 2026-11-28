'use client';

import { AssistantQueue } from '@/app/ods/office/assistant/_components/assistant-queue';
import { AssistantConversation, IdentityCard } from '@/app/ods/office/assistant/_components/assistant-conversation';
import { SalesPageHead } from '@/app/ods/office/_components/sales-bits';
import type { AssistantRow, AssistantTab, ConversationMessage } from '@/app/ods/office/assistant/_lib/assistant-core';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { ASSISTANT_FIXTURE_STATES, type AssistantFixtureState } from '../office-services/sample-data';

const BASE = '/dev/ui/screens/office-assistant';
const NOW = Date.parse('2026-11-27T12:00:00Z');
const min = (m: number) => new Date(NOW + m * 60_000).toISOString();
const wait = () => new Promise((r) => setTimeout(r, 250));

const ESC: AssistantRow[] = [
  { sessionId: 's1', key: 's1', orgName: 'Anna Home Trading', buyerCode: 'CUS-00418', country: 'AE', title: 'Refund for damaged cartons', status: 'escalated', reason: 'negative_sentiment', slaDueAt: min(-12), lastMessageAt: min(-20), lowTurns: 0, assignment: 'me', taken: false },
  { sessionId: 's2', key: 's2', orgName: 'Nordic Living AB', buyerCode: 'CUS-00402', country: 'SE', title: 'Change delivery address', status: 'escalated', reason: 'customer_request', slaDueAt: min(9), lastMessageAt: min(-6), lowTurns: 0, assignment: 'team', taken: false },
  { sessionId: 's3', key: 's3', orgName: 'Desert Bloom Retail', buyerCode: 'CUS-00425', country: 'SA', title: 'Pay-later terms question', status: 'human', reason: 'needs_approval', slaDueAt: min(95), lastMessageAt: min(-3), lowTurns: 0, assignment: 'colleague', taken: true },
];
const MINE: AssistantRow[] = [
  { sessionId: 's1', key: 'org:1', orgName: 'Anna Home Trading', buyerCode: 'CUS-00418', country: 'AE', title: 'Refund for damaged cartons', status: 'escalated', reason: null, slaDueAt: null, lastMessageAt: min(-20), lowTurns: 0, assignment: null, taken: false },
  { sessionId: null, key: 'org:2', orgName: 'Gulf Home Trading LLC', buyerCode: 'CUS-00377', country: 'AE', title: 'Conversation', status: null, reason: null, slaDueAt: null, lastMessageAt: null, lowTurns: 0, assignment: null, taken: false, kycStatus: 'verified' },
];
const LOW: AssistantRow[] = [
  { sessionId: 's4', key: 's4', orgName: 'Casa Verde SA', buyerCode: 'CUS-00433', country: 'ES', title: 'HS code for lamps', status: 'bot', reason: null, slaDueAt: null, lastMessageAt: min(-45), lowTurns: 3, assignment: null, taken: false },
];
const MSGS: ConversationMessage[] = [
  { id: 'm1', author: 'customer', authorName: null, content: 'Hi, 14 cartons of order ORD-2291 arrived crushed. I want a refund for those.', internal: false, confidence: null, tools: 0, createdAt: min(-40) },
  { id: 'm2', author: 'bot', authorName: null, content: 'I’m sorry about that. I can see ORD-2291 was delivered on 25 Nov. I’ll pass this to your account manager so they can arrange the refund.', internal: false, confidence: 0.42, tools: 2, createdAt: min(-39) },
  { id: 'm3', author: 'system', authorName: null, content: 'Handed to a human: negative sentiment.', internal: false, confidence: null, tools: 0, createdAt: min(-38) },
  { id: 'm4', author: 'staff', authorName: 'Omar Khalid', content: 'Checked the delivery photos: damage visible on 14 cartons. Raising a finance approval.', internal: true, confidence: null, tools: 0, createdAt: min(-25) },
  { id: 'm5', author: 'staff', authorName: 'Omar Khalid', content: 'Hi Anna, thanks for the photos. We’re refunding the 14 damaged cartons to your wallet; you’ll see it within one working day.', internal: false, confidence: null, tools: 0, createdAt: min(-20) },
];

export function AssistantFixture({ state }: { state: AssistantFixtureState }) {
  const isConv = state === 'conversation' || state === 'view-only';
  return (
    <OfficeScreenFrame pathname="/office/assistant" role="sales">
      <FixtureStates label="Fixture states (sample data)" links={ASSISTANT_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {isConv ? <Conversation viewOnly={state === 'view-only'} /> : <Queue state={state} />}
    </OfficeScreenFrame>
  );
}

function Queue({ state }: { state: AssistantFixtureState }) {
  const none = state === 'empty' || state === 'error' || state === 'loading';
  const tab: AssistantTab = state === 'mine' ? 'mine' : state === 'low' ? 'low' : 'escalations';
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead crumbs={[{ label: 'Support desk' }, { label: 'Assistant queue' }]} title="Assistant queue" subtitle="Customers handed over by Octo, your assigned customers, and conversations where Octo is unsure." />
      <AssistantQueue
        tab={tab}
        lists={none ? { escalations: [], mine: [], low: [] } : { escalations: ESC, mine: MINE, low: LOW }}
        nowMs={NOW}
        base={BASE}
        outOfOffice={state === 'out-of-office'}
        team="Sourcing"
        setOutOfOffice={async (v) => { await wait(); return { ok: true, message: v ? 'Out of office — new handoffs go to your team queue.' : 'Welcome back — handoffs come to you again.' }; }}
        loading={state === 'loading'}
        error={state === 'error'}
        sample
      />
    </div>
  );
}

function Conversation({ viewOnly }: { viewOnly: boolean }) {
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead crumbs={[{ label: 'Support desk' }, { label: 'Assistant queue', href: `${BASE}?state=queue` }, { label: 'Refund for damaged cartons' }]} title="Refund for damaged cartons" />
      <AssistantConversation
        sessionId="s1"
        status="human"
        hasOpenEscalation
        messages={MSGS}
        facts={[
          { key: 'ship:1', title: 'ORD-2291 · Delivered', text: 'ORD-2291 delivered 25 Nov 2026 to Dubai (Jebel Ali). 120 cartons, POD signed.', kind: 'shipment', ref: 'ORD-2291' },
          { key: 'wallet', title: 'Wallet', text: 'Available US$ 2,140.00 · held US$ 0.00', kind: 'wallet', ref: 'org-1' },
        ]}
        identity={(
          <IdentityCard v={{
            org: { name: 'Anna Home Trading', buyerCode: 'CUS-00418', country: 'United Arab Emirates (AE)', city: 'Dubai', kycStatusName: 'Verified', kycRaw: 'Verified' },
            contact: { name: 'Anna Petrova', email: 'anna@annahome.example' },
            manager: { name: 'Omar Khalid', you: true, outOfOffice: false, team: 'Sourcing', since: '2 Mar 2026' },
            startedAt: '27 Nov 2026, 11:20', channel: 'Web', pageContext: '/account/orders/ORD-2291',
            escalation: { reason: 'negative_sentiment', reasonText: 'Negative sentiment', slaText: <span className="font-mono text-ods-small font-semibold text-ods-danger">Overdue 12 min</span>, excerpt: '14 cartons arrived crushed', assigned: 'to me', takenBy: 'me', resolved: null, ticket: { code: 'TCK-1182', status: 'open', href: '/office/support?t=sample' } },
          }} />
        )}
        canReply={!viewOnly}
        canTakeOver={!viewOnly}
        canClose={!viewOnly}
        reply={async (_s, content, internal) => { await wait(); return content.trim() ? { ok: true, message: internal ? 'Internal note saved.' : 'Reply sent.' } : { ok: false, error: 'Write a message first.' }; }}
        takeOver={async () => { await wait(); return { ok: true, message: 'You now own this conversation. Octo is paused.' }; }}
        resolve={async (_s, outcome, close) => { await wait(); return outcome.trim() ? { ok: true, message: close ? 'Conversation closed.' : 'Handed back to Octo.' } : { ok: false, error: 'REASON_REQUIRED' }; }}
        lookup={async (ref) => { await wait(); return { ok: true, fact: ref.trim() ? { title: `${ref} · In transit`, text: `${ref}: departed Ningbo 20 Nov, ETA Jebel Ali 4 Dec.` } : null }; }}
        refresh={async () => { await wait(); return { ok: true, fact: { title: 'Wallet', text: 'Available US$ 2,140.00 · held US$ 0.00' } }; }}
        sample
      />
    </div>
  );
}
