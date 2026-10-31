import { describe, expect, it } from 'vitest';
import { signPayload as appSign } from '@/lib/adapters';
import { backupReportArgs, parseCallback, restoreReportArgs } from '@/lib/backup/callback';
import { maintenanceResponse, parseMaintenance } from '@/lib/backup/maintenance';
import { signPayload as workflowSign } from '@/scripts/backup/lib.mjs';

const SECRET = 'cb-secret';
const RID = '7f0c2b9e-4c1a-4d55-9b44-1d2f3a4b5c6d';

describe('backup status callback (HMAC)', () => {
  it('workflow signer matches the app signer', () => {
    expect(workflowSign('{"a":1}', SECRET, 1700000000)).toBe(appSign('{"a":1}', SECRET, 1700000000));
  });

  it('accepts a signed backup report and maps backup_report args', () => {
    const body = JSON.stringify({ type: 'backup', code: 'BK-2026-1101-0200', status: 'completed', size_bytes: 123, files: [{ path: 'db/data.sql.gz.age', kind: 'db_data', size_bytes: '10', sha256: 'aa' }], checksum_ok: true, github_run_id: 42 });
    const r = parseCallback(body, workflowSign(body, SECRET), SECRET);
    expect(r.ok).toBe(true);
    if (!r.ok || r.body.type !== 'backup') throw new Error('expected backup');
    const a = backupReportArgs(r.body);
    expect(a).toMatchObject({ p_code: 'BK-2026-1101-0200', p_status: 'completed', p_size_bytes: 123, p_checksum_ok: true, p_github_run_id: '42', p_trigger: null });
    expect(a.p_files?.[0].size_bytes).toBe(10);
  });

  it('rejects bad / expired / missing signatures and unconfigured secret', () => {
    const body = JSON.stringify({ type: 'retention_plan' });
    expect(parseCallback(body, workflowSign(body, 'other'), SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(parseCallback(body, workflowSign(body, SECRET, Math.floor(Date.now() / 1000) - 3600), SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(parseCallback(body, null, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(parseCallback(body, workflowSign(body, SECRET), undefined)).toMatchObject({ ok: false, status: 503 });
    const tampered = JSON.stringify({ type: 'maintenance', enabled: true });
    expect(parseCallback(tampered, workflowSign(body, SECRET), SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  it('validates payloads (422) and supports the `action` alias', () => {
    const bad = JSON.stringify({ type: 'backup', code: 'nope', status: 'completed' });
    expect(parseCallback(bad, workflowSign(bad, SECRET), SECRET)).toMatchObject({ ok: false, status: 422, error: 'INVALID_PAYLOAD' });
    const alias = JSON.stringify({ action: 'maintenance', enabled: false });
    const r = parseCallback(alias, workflowSign(alias, SECRET), SECRET);
    expect(r.ok && r.body.type).toBe('maintenance');
  });

  it('maps restore_report args, normalises unknown check kinds and defaults the phase', () => {
    const body = JSON.stringify({ type: 'restore', restore_id: RID, status: 'completed', checks: [{ kind: 'weird', status: 'pass', detail: 'x' }, { kind: 'ledger_balanced', status: 'fail', detail: 'y' }] });
    const r = parseCallback(body, workflowSign(body, SECRET), SECRET);
    if (!r.ok || r.body.type !== 'restore') throw new Error('expected restore');
    const a = restoreReportArgs(r.body);
    expect(a.p_phase).toBe('post_restore');
    expect(a.p_checks?.map((c) => c.kind)).toEqual(['other', 'ledger_balanced']);
    const v = JSON.stringify({ type: 'restore', restore_id: RID, status: 'verified' });
    const rv = parseCallback(v, workflowSign(v, SECRET), SECRET);
    if (!rv.ok || rv.body.type !== 'restore') throw new Error('expected restore');
    expect(restoreReportArgs(rv.body).p_phase).toBe('verify');
  });
});

describe('maintenance mode', () => {
  it('parses the setting with safe defaults', () => {
    expect(parseMaintenance(null).enabled).toBe(false);
    expect(parseMaintenance({ enabled: true, retry_after: 60, message: 'Back soon' })).toMatchObject({ enabled: true, retryAfter: 60, message: 'Back soon' });
    expect(parseMaintenance({ enabled: true, retry_after: 'x' }).retryAfter).toBe(900);
  });

  it('answers 503 problem+json with Retry-After', async () => {
    const res = maintenanceResponse(parseMaintenance({ enabled: true, retry_after: 120, message: 'Restoring' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'MAINTENANCE', detail: 'Restoring', retry_after: 120 });
  });
});
