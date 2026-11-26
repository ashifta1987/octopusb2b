import { pgClient } from './customer';
import { assertStagingDatabase } from '../../../scripts/lib-staging-guard.mjs';
import type pg from 'pg';

/**
 * Turnkey T3 E2E helpers (STAGING ONLY). They call the same database functions the app calls, acting as the given staff
 * user through JWT claims (what PostgREST does), so every rule still applies: the proposer is a Turnkey editor or an
 * admin; a fee above 2× the starting fee needs an approver who is another admin; the payment goes through
 * pay_service_proforma as a Finance bank transfer (service role, the path Admin › Finance › Transfers uses).
 */
async function asUser(db: pg.Client, uid: string) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal2' })]);
  await db.query('set local role authenticated');
}
async function asSystem(db: pg.Client) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claims', '', true)`);
}

/** Sets a fee (an admin approves it when above 2× the starting fee) and records a bank transfer for it. Returns the fee and proforma ids. */
export async function seedPaidTurnkeyFee(o: { projectId: string; stage: string; service: string | null; cents: number; proposer: string; approver?: string; reference: string }) {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await asUser(db, o.proposer);
    const set = (await db.query(`select tk_propose_fee($1, $2, $3, $4, 'E2E seeded fee') r`, [o.projectId, o.stage, o.service, o.cents])).rows[0].r as { id: string; status: string; document_id?: string };
    const feeId = set.id;
    let documentId = set.document_id ?? '';
    if (set.status !== 'active') {
      if (!o.approver) throw new Error('seedPaidTurnkeyFee: this fee is above 2x the starting fee; pass an approver (another admin)');
      await asUser(db, o.approver);
      documentId = (await db.query(`select tk_decide_fee($1, 'approve', null) r`, [feeId])).rows[0].r.document_id as string;
    }
    await asSystem(db);
    await db.query(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null)`, [documentId, o.cents, o.reference]);
    await db.query('commit');
    return { feeId, documentId };
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

/** Finance records the client's bank transfer for a turnkey fee proforma (existing payment confirmation path). */
export async function recordBankTransfer(documentId: string, cents: number, reference: string) {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await asSystem(db);
    const r = (await db.query(`select pay_service_proforma($1, $2, 'bank_transfer', $3, null) r`, [documentId, cents, reference])).rows[0].r;
    await db.query('commit');
    return r as { fully_paid: boolean };
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
