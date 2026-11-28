'use client';

import { useState } from 'react';
import { Button } from '@octopus/ui';

/** Fixture stand-in for today's MessageForm (which posts to post_request_message): same fields, sample only. */
export function SampleReplyForm() {
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
        setBody('');
      }}
    >
      <label htmlFor="msg" className="text-ods-label font-semibold text-ods-navy">
        Reply to the customer
      </label>
      <textarea id="msg" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} className="min-h-[84px] rounded-ods-control border border-ods-line-strong bg-ods-surface p-2 text-ods-body" />
      {sent ? (
        <p role="status" className="m-0 text-ods-small text-ods-success">
          Sent (sample — nothing was saved).
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={!body.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}
