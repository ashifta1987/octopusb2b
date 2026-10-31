/** Staff 2FA backup codes (SPEC §17.2): 10 single-use codes, stored as sha256 only. Pure helpers (unit-tested). */
import { createHash, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export const BACKUP_CODE_COUNT = 10;

/** One code like "K7QX-M2PA". */
export function newBackupCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function newBackupCodes(n = BACKUP_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < n) set.add(newBackupCode());
  return [...set];
}

/** Case/space/dash-insensitive form used for hashing. */
export function normaliseBackupCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normaliseBackupCode(code)).digest('hex');
}
