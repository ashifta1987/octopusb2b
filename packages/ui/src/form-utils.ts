import { cx } from './cx';

/**
 * Pure helpers for the forms group (no 'use client', server-safe, unit-tested in tests/unit/ods-forms.test.ts).
 */

/**
 * Shared look of text-like controls (Input, Select, Textarea, NumberInput, DateInput): 44 / 32 px via h-ods-control.
 * Border = slate at 70 % (≈ 3.1:1 on white, WCAG 1.4.11 for the control's edge), navy on hover, blue on focus (plus
 * the global amber ring), red + 1 px red ring when aria-invalid, grey when disabled or read-only.
 */
export function odsControlClass(extra?: string | false) {
  return cx(
    'block w-full min-w-0 rounded-ods-control border border-ods-slate/70 bg-ods-surface px-3 text-ods-body text-ods-text',
    'transition-colors duration-(--ods-motion-fast) ease-ods placeholder:text-ods-slate',
    'hover:border-ods-navy focus:border-ods-blue',
    'aria-invalid:border-ods-danger aria-invalid:ring-1 aria-invalid:ring-ods-danger',
    'disabled:cursor-not-allowed disabled:border-ods-line disabled:bg-ods-canvas disabled:text-ods-slate',
    '[&[readonly]]:border-ods-line [&[readonly]]:bg-ods-canvas [&[readonly]]:hover:border-ods-line',
    extra,
  );
}

/** "1,250.50" / "US$ 1 250.5" / "1250" → number; '' or junk → null. */
export function parseDecimal(raw: string): number | null {
  const s = raw.replace(/US\$|[\s,]/g, '').replace('\u2212', '-');
  if (!s || !/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Plain-English validation for NumberInput. Returns the message to show, or null when fine. */
export function validateNumber(raw: string, opts: { min?: number; max?: number; step?: number; required?: boolean; format?: (n: number) => string } = {}): string | null {
  const { min, max, step, required, format = (n) => String(n) } = opts;
  if (!raw.trim()) return required ? 'Enter an amount.' : null;
  const n = parseDecimal(raw);
  if (n === null) return 'Enter a number, like 1250.00.';
  if (min !== undefined && n < min) return `Enter ${format(min)} or more.`;
  if (max !== undefined && n > max) return `Enter ${format(max)} or less.`;
  if (step !== undefined && step > 0) {
    const base = min ?? 0;
    const q = (n - base) / step;
    if (Math.abs(q - Math.round(q)) > 1e-9) return `Use steps of ${format(step)}.`;
  }
  return null;
}

/** Clamps a quantity to [min, max] and snaps it to the step (counted from min). */
export function clampQuantity(n: number, opts: { min?: number; max?: number; step?: number } = {}): number {
  const { min = 0, max = Number.POSITIVE_INFINITY, step = 1 } = opts;
  if (!Number.isFinite(n)) return min;
  const snapped = step > 0 ? min + Math.round((n - min) / step) * step : n;
  let v = Math.min(max, Math.max(min, snapped));
  // after clamping to max, stay on the step grid
  if (step > 0 && v > min && (v - min) % step !== 0) v = min + Math.floor((v - min) / step) * step;
  return v;
}

/** 0 → "0 B", 1536 → "1.5 KB", 10485760 → "10 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** Same rules as the `accept` attribute: ".pdf", "image/*", "image/png" (comma separated). Empty accept = anything. */
export function fileMatchesAccept(file: { name: string; type?: string }, accept?: string): boolean {
  if (!accept || !accept.trim()) return true;
  const name = file.name.toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => {
      if (a.startsWith('.')) return name.endsWith(a);
      if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
      return type === a;
    });
}

/** Message for a file that can't be added (wrong type or too big), or null when it's fine. */
export function validateFile(file: { name: string; size: number; type?: string }, opts: { accept?: string; acceptLabel?: string; maxSize?: number } = {}): string | null {
  const { accept, acceptLabel, maxSize } = opts;
  if (!fileMatchesAccept(file, accept)) return `${file.name} can't be added: only ${acceptLabel ?? accept} files are accepted.`;
  if (maxSize !== undefined && file.size > maxSize) return `${file.name} is ${formatFileSize(file.size)}; the limit is ${formatFileSize(maxSize)}.`;
  return null;
}
