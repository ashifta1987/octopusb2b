'use client';

import { useState } from 'react';
import { Button, Field, Textarea } from '@octopus/ui';
import { createTicket } from '@/app/account/support/actions';
import { ActionMessage, useRun } from '../../_services/action-kit';

/**
 * Approve the proof or ask for changes. Today's app has no customer proof action for Make My Brand (staff move the status),
 * so the answer goes to the account manager as a support ticket through TODAY's createTicket action (create_ticket RPC),
 * with the project reference in the subject. The team then moves the project on.
 */
export function ProofReply({ refCode }: { refCode: string }) {
  const { pending, msg, run } = useRun({ refresh: false });
  const [mode, setMode] = useState<'approve' | 'changes' | null>(null);
  const [body, setBody] = useState('');
  const send = (approve: boolean) => run(async () => {
    const r = await createTicket({
      category: 'question',
      subject: approve ? `Proof approved: ${refCode}` : `Changes to the proof: ${refCode}`,
      body: approve ? `We approve the proof for ${refCode}.${body.trim() ? `\n\n${body.trim()}` : ''}` : `Please change the proof for ${refCode}:\n\n${body.trim()}`,
      orderId: null, attachments: [],
    });
    return r.ok ? { ok: true, text: approve ? 'Sent: your account manager now moves the project to the sample step.' : 'Sent: your account manager replies with a new proof.' } : { ok: false, text: r.error };
  }, () => { setBody(''); setMode(null); });
  if (msg?.ok) return <ActionMessage msg={msg} testId={`proof-sent-${refCode}`} />;
  return (
    <div className="flex flex-col gap-3">
      {mode ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send(mode === 'approve'); }}>
          <Field label={mode === 'approve' ? 'Comment' : 'What should change?'} optional={mode === 'approve'} required={mode === 'changes'}>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} />
          </Field>
          <ActionMessage msg={msg} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={pending} disabled={mode === 'changes' && body.trim().length < 5} disabledReason={mode === 'changes' && body.trim().length < 5 ? 'Write what should change first.' : undefined}>
              {mode === 'approve' ? 'Send approval' : 'Send changes'}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Back</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode('approve')} data-testid={`proof-approve-${refCode}`}>Approve proof</Button>
          <Button variant="secondary" onClick={() => setMode('changes')} data-testid={`proof-changes-${refCode}`}>Request changes</Button>
        </div>
      )}
      <p className="m-0 text-ods-small text-ods-slate">Your answer goes to your account manager as a support ticket. One-click approval in your account comes later.</p>
    </div>
  );
}
