'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Columns3, Plus, Trash2, X } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { useEscape, useOutsideClick } from '../hooks';
import { Button, IconButton } from './button';

export type GridFilterChip = { id: string; label: string };
export type GridFilterField = { id: string; label: string; /** Value choices; a text box when omitted. */ options?: string[] };
export type GridFilterCondition = { field: string; operator: string; value: string };
export type GridFilterJoin = 'and' | 'or';

const OPERATORS = ['is', 'is not', 'contains', 'is more than', 'is less than', 'is before', 'is after'];

const chipH = 'h-[calc(var(--ods-control-h)-4px)]'; // 28 px compact, 40 comfortable (FilterPills sizes)

/**
 * Filter chips (Part 7.2): one chip per active filter with ✕ (labelled "Remove filter …"), then "+ Add filter", which
 * toggles the advanced filter panel (`aria-expanded` / `aria-controls`). Phones: chips wrap.
 */
export function GridFilterChips({
  filters,
  onRemove,
  onAdd,
  addExpanded,
  addControls,
  label = 'Active filters',
}: {
  filters: GridFilterChip[];
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  addExpanded?: boolean;
  addControls?: string;
  label?: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {filters.length ? (
        <ul aria-label={label} className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <li key={f.id} className={cx(chipH, 'inline-flex items-center gap-1 rounded-ods-control border border-ods-blue/30 bg-ods-blue-tint ps-2.5 pe-1 text-ods-small font-semibold text-ods-info')}>
              {f.label}
              {onRemove ? (
                <button
                  type="button"
                  aria-label={`Remove filter ${f.label}`}
                  onClick={() => onRemove(f.id)}
                  className="inline-grid size-5 place-items-center rounded-[4px] text-ods-slate hover:bg-ods-surface hover:text-ods-navy"
                >
                  <Icon icon={X} size="xs" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-expanded={addExpanded}
          aria-controls={addExpanded ? addControls : undefined}
          className={cx(chipH, 'inline-flex items-center gap-1 rounded-ods-control border border-dashed border-ods-line-strong bg-ods-surface px-2.5 text-ods-small font-semibold text-ods-navy hover:border-ods-navy')}
        >
          <Icon icon={Plus} size="xs" /> Add filter
        </button>
      ) : null}
    </div>
  );
}

/**
 * Advanced filter panel shell (Part 7.2): rows of field / operator / value, match all (AND) or any (OR), add/remove
 * conditions, Apply / Cancel. UI only: `onApply` gets the conditions; the page turns them into a server query.
 * Phones: the rows stack (grids are desktop tools; see OctopusDataGrid).
 */
export function GridFilterPanel({
  id,
  fields,
  onApply,
  onCancel,
  defaultConditions,
  defaultJoin = 'and',
}: {
  id?: string;
  fields: GridFilterField[];
  onApply: (conditions: GridFilterCondition[], join: GridFilterJoin) => void;
  onCancel: () => void;
  defaultConditions?: GridFilterCondition[];
  defaultJoin?: GridFilterJoin;
}) {
  const uid = useId();
  const blank = (): GridFilterCondition => ({ field: fields[0]?.id ?? '', operator: 'is', value: '' });
  const [rows, setRows] = useState<GridFilterCondition[]>(defaultConditions?.length ? defaultConditions : [blank()]);
  const [join, setJoin] = useState<GridFilterJoin>(defaultJoin);
  const set = (i: number, patch: Partial<GridFilterCondition>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const control = 'h-ods-control min-w-0 rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body text-ods-text';
  return (
    <div id={id} role="group" aria-label="Advanced filters" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
      <fieldset className="mb-3 flex flex-wrap items-center gap-3 text-ods-small">
        <legend className="sr-only">Match</legend>
        <span className="font-semibold text-ods-navy" aria-hidden>
          Match
        </span>
        {(['and', 'or'] as const).map((j) => (
          <label key={j} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`${uid}-join`} checked={join === j} onChange={() => setJoin(j)} className="accent-(--ods-blue)" />
            {j === 'and' ? 'All conditions (AND)' : 'Any condition (OR)'}
          </label>
        ))}
      </fieldset>
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const field = fields.find((f) => f.id === r.field);
          return (
            <li key={i} className="grid grid-cols-1 items-center gap-2 ods-tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <label className="sr-only" htmlFor={`${uid}-f${i}`}>
                Condition {i + 1} field
              </label>
              <select id={`${uid}-f${i}`} className={control} value={r.field} onChange={(e) => set(i, { field: e.target.value, value: '' })}>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`${uid}-o${i}`}>
                Condition {i + 1} operator
              </label>
              <select id={`${uid}-o${i}`} className={control} value={r.operator} onChange={(e) => set(i, { operator: e.target.value })}>
                {OPERATORS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`${uid}-v${i}`}>
                Condition {i + 1} value
              </label>
              {field?.options ? (
                <select id={`${uid}-v${i}`} className={control} value={r.value} onChange={(e) => set(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {field.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input id={`${uid}-v${i}`} className={control} value={r.value} onChange={(e) => set(i, { value: e.target.value })} />
              )}
              <IconButton icon={Trash2} label={`Remove condition ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" iconStart={Plus} onClick={() => setRows([...rows, blank()])}>
          Add condition
        </Button>
        <span className="ms-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApply(rows, join)}>
            Apply filters
          </Button>
        </span>
      </div>
    </div>
  );
}

export type GridColumnOption = { id: string; label: string; visible: boolean; hideable?: boolean };

/** "Columns" button + popover of checkboxes to show/hide columns. Esc / outside click closes; focus returns to the button. */
export function GridColumnsMenu({ columns, onToggle, label = 'Columns' }: { columns: GridColumnOption[]; onToggle: (id: string, visible: boolean) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEscape(open, () => {
    setOpen(false);
    btn.current?.focus();
  });
  useOutsideClick([btn, panel], open, () => setOpen(false));
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
  }, [open]);
  return (
    <div className="relative">
      <IconButton ref={btn} icon={Columns3} label={label} variant="secondary" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} />
      {open ? (
        <div ref={panel} id={id} className="absolute end-0 top-full z-(--z-dropdown) mt-1 w-64 rounded-ods-control border border-ods-line bg-ods-surface p-3 shadow-ods-pop">
          <fieldset>
            <legend className="mb-2 text-ods-small font-semibold text-ods-navy">Show columns</legend>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {columns.map((c) => (
                <li key={c.id}>
                  <label className={cx('flex min-h-ods-control items-center gap-2 text-ods-body', c.hideable === false && 'text-ods-slate')}>
                    <input type="checkbox" checked={c.visible} disabled={c.hideable === false} onChange={(e) => onToggle(c.id, e.target.checked)} className="size-4 accent-(--ods-blue)" />
                    <span className="flex-1">{c.label}</span>
                    {c.hideable === false ? <span className="text-ods-small">Always shown</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
