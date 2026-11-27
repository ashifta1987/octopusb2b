import { Fragment } from 'react';
import { cx } from '../cx';
import { Kbd } from './button';

export type ShortcutItem = { keys: string[]; action: string; /** How keys combine: '+' together (default), '/' either one, 'then' one after another (G then I). */ join?: '+' | '/' | 'then' };

/** Part 7.1 Back Office keyboard shortcuts (Help › Keyboard shortcuts). Spec constants, not sample data. */
export const ODS_SHORTCUTS: ShortcutItem[] = [
  { keys: ['Ctrl', 'K'], action: 'Command palette' },
  { keys: ['Ctrl', 'B'], action: 'Collapse or expand the sidebar' },
  { keys: ['Ctrl', 'S'], action: 'Save' },
  { keys: ['Esc'], action: 'Close' },
  { keys: ['Alt', 'W'], action: 'Close the current tab' },
  { keys: ['Ctrl', 'Tab'], action: 'Next tab' },
  { keys: ['N'], action: 'New record' },
  { keys: ['/'], action: 'Focus the grid search' },
  { keys: ['J', 'K'], action: 'Next / previous row', join: '/' },
  { keys: ['Enter'], action: 'Open the selected row' },
  { keys: ['Ctrl', 'Enter'], action: 'Open the selected row in a new tab' },
];

/**
 * ShortcutsList: a description list of keys → action (Part 7.1). Server-safe. On a Mac, "Ctrl" also works as ⌘.
 * Phones: a single column (shortcuts only matter with a keyboard, so the help menu hides it on touch devices).
 */
export function ShortcutsList({ items = ODS_SHORTCUTS, className, caption }: { items?: ShortcutItem[]; className?: string; caption?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      {caption ? <p className="mb-2 text-ods-small text-ods-slate">{caption}</p> : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-ods-body">
        {items.map((s) => (
          <Fragment key={s.action}>
            <dt className="flex items-center gap-1 text-ods-navy">
              {s.keys.map((k, i) => (
                <Fragment key={k + i}>
                  {i > 0 ? <span className="text-ods-small text-ods-slate">{s.join === 'then' ? 'then' : (s.join ?? '+')}</span> : null}
                  <Kbd>{k}</Kbd>
                </Fragment>
              ))}
            </dt>
            <dd className="m-0 self-center text-ods-text">{s.action}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
