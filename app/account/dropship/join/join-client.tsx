'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsButton, DsCard, DsNotice } from '@/components/dropship-ui';
import { fmtDate, ROLE_LABELS } from '@/lib/dropship-ds12-shared';
import { acceptInviteAction } from '../ds12-actions';

export function JoinClient({ invites }: { invites: { id: string; company: string; ds_role: 'manager' | 'support'; expires_at: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {msg && <DsNotice tone={msg.ok ? 'ok' : 'bad'} title={msg.ok ? 'You joined the team' : 'Not joined'} testId="join-notice">{msg.text}</DsNotice>}
      {invites.map((i) => (
        <DsCard key={i.id} title={i.company} icon="users" testId={`join-invite-${i.id}`}>
          <p className="m-0 mb-3 text-[14px] text-black">Role: <strong>{ROLE_LABELS[i.ds_role].label}</strong> — {ROLE_LABELS[i.ds_role].can}. Valid until {fmtDate(i.expires_at)}.</p>
          <DsButton loading={pending} testId="join-accept" onClick={() => start(async () => {
            const r = await acceptInviteAction(i.id);
            setMsg(r.ok ? { ok: true, text: 'Opening Octopus Dropship…' } : { ok: false, text: r.message });
            if (r.ok) router.push('/account/dropship');
          })}>Accept invitation</DsButton>
        </DsCard>
      ))}
    </div>
  );
}
