'use client';

import { useId, useState, type DragEvent } from 'react';
import { CircleAlert, CircleCheck, FileText, Lock, Upload, X } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { buttonClass } from '../styles';
import { formatFileSize, validateFile } from '../form-utils';
import { IconButton } from './button';
import { useFieldControl } from './field';

export type FileDropItem = {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  /** 0–100 while uploading. */
  progress?: number;
  /** Shown when status is "error" (what happened + what to do). */
  error?: string;
};

export type FileDropProps = {
  /** Same syntax as <input accept>: ".pdf,.jpg,image/png". */
  accept?: string;
  /** Plain words for the accepted types, e.g. "PDF, JPG or PNG". */
  acceptLabel?: string;
  /** Max size per file in bytes. */
  maxSize?: number;
  multiple?: boolean;
  /** Files already added (the parent owns uploads, progress and errors). */
  files: FileDropItem[];
  /** Only valid files arrive here; wrong type / too big are refused with a message in the drop zone. */
  onFilesAdded: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Button text. */
  buttonLabel?: string;
  /** Text before the button. */
  prompt?: string;
  id?: string;
  'aria-describedby'?: string;
  className?: string;
};

/**
 * FileDrop: drag-and-drop zone + a real file input (keyboard: Tab to "Choose files", Enter/Space opens the picker).
 * Shows the accepted types and max size, refuses wrong type / too-big files with a plain message (live region),
 * and lists files with size, upload progress (progressbar), done / error state and a "Remove {name}" button.
 * Phones: the zone shrinks to the button + text (drag-and-drop is rare); the list stacks.
 */
export function FileDrop({
  accept,
  acceptLabel,
  maxSize,
  multiple = true,
  files,
  onFilesAdded,
  onRemove,
  disabled: disabledProp,
  disabledReason,
  buttonLabel = 'Choose files',
  prompt = 'Drag files here, or',
  className,
  ...aria
}: FileDropProps) {
  const f = useFieldControl({ ...aria, disabled: disabledProp });
  const rulesId = useId();
  const rejectId = useId();
  const reasonId = useId();
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const rules = [acceptLabel ?? accept, maxSize ? `up to ${formatFileSize(maxSize)}${multiple ? ' each' : ''}` : null].filter(Boolean).join(' · ');

  const take = (list: FileList | null) => {
    if (!list || f.disabled) return;
    const all = Array.from(list).slice(0, multiple ? undefined : 1);
    const ok: File[] = [];
    const bad: string[] = [];
    for (const file of all) {
      const msg = validateFile(file, { accept, acceptLabel, maxSize });
      if (msg) bad.push(msg);
      else ok.push(file);
    }
    setRejected(bad);
    if (ok.length) onFilesAdded(ok);
  };
  const drag = (e: DragEvent, on: boolean) => {
    e.preventDefault();
    if (!f.disabled) setOver(on);
  };

  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <div
        onDragEnter={(e) => drag(e, true)}
        onDragOver={(e) => drag(e, true)}
        onDragLeave={(e) => drag(e, false)}
        onDrop={(e) => {
          drag(e, false);
          take(e.dataTransfer.files);
        }}
        className={cx(
          'flex flex-col items-center gap-2 rounded-ods-card border-2 border-dashed p-4 text-center transition-colors ods-tablet:p-6',
          f.disabled ? 'border-ods-line bg-ods-canvas text-ods-slate' : over ? 'border-ods-blue bg-ods-blue-tint' : f.invalid ? 'border-ods-danger bg-ods-surface' : 'border-ods-slate/70 bg-ods-surface',
        )}
      >
        <Icon icon={Upload} size="lg" className={f.disabled ? 'text-ods-slate' : 'text-ods-blue'} />
        <p className="hidden text-ods-body text-ods-text ods-tablet:block">{over ? 'Drop to add' : prompt}</p>
        <input
          type="file"
          id={f.id}
          accept={accept}
          multiple={multiple}
          disabled={f.disabled}
          aria-describedby={cx(f.describedBy, rules && rulesId, rejected.length > 0 && rejectId, f.disabled && disabledReason && reasonId) || undefined}
          aria-invalid={f.invalid || rejected.length > 0 || undefined}
          aria-required={f.required || undefined}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = '';
          }}
          className="peer sr-only"
        />
        <label
          htmlFor={f.id}
          className={cx(
            buttonClass('secondary', 'md'),
            'cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ods-focus peer-focus-visible:outline-solid',
            f.disabled && 'cursor-not-allowed border-ods-line bg-ods-canvas text-ods-slate hover:border-ods-line hover:bg-ods-canvas',
          )}
        >
          {buttonLabel}
        </label>
        {rules ? (
          <p id={rulesId} className="text-ods-small text-ods-slate">
            {rules}
          </p>
        ) : null}
        {f.disabled && disabledReason ? (
          <p id={reasonId} className="flex items-center gap-1 text-ods-small text-ods-slate">
            <Icon icon={Lock} size="xs" />
            {disabledReason}
          </p>
        ) : null}
      </div>
      <div aria-live="polite" id={rejectId}>
        {rejected.map((m) => (
          <p key={m} className="flex items-start gap-1 text-ods-small font-medium text-ods-danger">
            <Icon icon={CircleAlert} size="xs" className="mt-[0.15em]" />
            <span>{m}</span>
          </p>
        ))}
      </div>
      {files.length ? (
        <ul aria-label="Added files" className="flex flex-col gap-2">
          {files.map((file) => (
            <li key={file.id} className={cx('flex min-w-0 items-center gap-3 rounded-ods-control border px-3 py-2', file.status === 'error' ? 'border-ods-danger bg-ods-danger-tint' : 'border-ods-line bg-ods-surface')}>
              <Icon icon={FileText} className="text-ods-slate" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-ods-body font-medium text-ods-text">{file.name}</span>
                  <span className="shrink-0 text-ods-small text-ods-slate tabular-nums">{formatFileSize(file.size)}</span>
                </div>
                {file.status === 'uploading' ? (
                  <div className="mt-1 flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={file.progress ?? 0}
                      className="h-1.5 flex-1 overflow-hidden rounded-ods-pill bg-ods-line"
                    >
                      <div className="h-full bg-ods-blue transition-[width]" style={{ width: `${file.progress ?? 0}%` }} />
                    </div>
                    <span className="text-ods-small text-ods-slate tabular-nums">{file.progress ?? 0}%</span>
                  </div>
                ) : file.status === 'done' ? (
                  <span className="mt-0.5 flex items-center gap-1 text-ods-small text-ods-success">
                    <Icon icon={CircleCheck} size="xs" />
                    Uploaded
                  </span>
                ) : (
                  <span className="mt-0.5 flex items-start gap-1 text-ods-small font-medium text-ods-danger">
                    <Icon icon={CircleAlert} size="xs" className="mt-[0.15em]" />
                    {file.error ?? 'Upload failed. Try again.'}
                  </span>
                )}
              </div>
              <IconButton icon={X} label={`Remove ${file.name}`} tooltipSide="start" onClick={() => onRemove(file.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
