'use client';

import { useState } from 'react';
import { DsButton, DsCard, DsInput } from '@/components/dropship-ui';
import type { RetentionRow } from '@/lib/warehouse-w6';
import { saveServiceSettingsAction } from '../w6-actions';
import { MsgLine, useRun } from '../wh-run';

function Row({ r }: { r: RetentionRow }) {
  const save = useRun();
  const [d, setD] = useState(r.dock_to_shelf_target_hours?.toString() ?? '');
  const [h, setH] = useState(r.handoff_target_hours?.toString() ?? '');
  const [days, setDays] = useState(r.return_photo_retention_days?.toString() ?? '');
  const id = r.warehouse_code;
  return (
    <section className="border border-[#E3E7EF] rounded-[12px] p-4 flex flex-col gap-3" data-testid={`wh-set-${id}`} aria-labelledby={`wh-set-h-${id}`}>
      <h3 id={`wh-set-h-${id}`} className="m-0 text-[16px] font-bold">{r.warehouse} ({id})</h3>
      <ul className="m-0 pl-4 text-[13px] text-[#5B6478] flex flex-col gap-0.5">
        <li>Packing photos are kept {r.evidence_retention_days} days (Packing station settings), then deleted by the nightly job: {r.evidence_due} waiting, {r.evidence_purged} deleted so far.</li>
        <li>Return photos: {r.return_photo_retention_days == null ? 'kept (no retention set)' : `kept ${r.return_photo_retention_days} days after the return is finished`} — {r.return_photos_due} waiting, {r.return_photos_purged} deleted so far.</li>
        <li>Product photos and label files no record points at are deleted after 30 days.</li>
      </ul>
      {r.can_edit ? (
        <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => {
          e.preventDefault();
          save.run(() => saveServiceSettingsAction({ warehouse: id, dockToShelf: d, handoff: h, returnPhotoDays: days }));
        }}>
          <DsInput id={`wh-set-d2s-${id}`} label="Dock-to-shelf target (hours)" inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} placeholder="No target" />
          <DsInput id={`wh-set-ho-${id}`} label="Order-to-handoff target (hours)" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} placeholder="No target" />
          <DsInput id={`wh-set-rp-${id}`} label="Keep return photos (days)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Keep" />
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
            <DsButton type="submit" variant="secondary" loading={save.pending} disabled={save.pending} testId={`wh-set-save-${id}`}>Save targets and retention</DsButton>
            <MsgLine msg={save.msg} testId={`wh-set-msg-${id}`} />
          </div>
        </form>
      ) : (
        <p className="m-0 text-[13px]">
          Targets: dock to shelf {r.dock_to_shelf_target_hours == null ? 'not set' : `${r.dock_to_shelf_target_hours} h`}, order to handoff {r.handoff_target_hours == null ? 'not set' : `${r.handoff_target_hours} h`}. A warehouse admin changes them.
        </p>
      )}
    </section>
  );
}

/** Targets (service-quality bars) and retention per warehouse; warehouse admins edit, everyone else reads. */
export function SettingsCard({ rows }: { rows: RetentionRow[] }) {
  return (
    <DsCard title="Targets and retention" icon="gear" testId="wh-rep-settings"
      subtitle="No target means no bar — a bar is only drawn against a target someone set. Deleted photo files cannot be restored; the records stay.">
      {rows.length === 0 ? <p className="m-0 text-[14px] text-[#5B6478]">No warehouse to show.</p> : (
        <div className="flex flex-col gap-3">{rows.map((r) => <Row key={r.warehouse_code} r={r} />)}</div>
      )}
    </DsCard>
  );
}
