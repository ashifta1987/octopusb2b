import crypto from 'node:crypto';
import { adminClient, pgClient } from './customer';
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

/** T4: moves a project one phase as the given Turnkey editor (same function as the staff page; every gate applies). */
export async function moveTurnkeyStage(projectId: string, stage: string, uid: string) {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await asUser(db, uid);
    await db.query(`select tk_move_project_stage($1, $2, null)`, [projectId, stage]);
    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

/**
 * T5: takes a fresh enquiry to Production and QC through the real functions and gates (T3 fees paid by recorded bank
 * transfer, a layout drawing uploaded to the private bucket and approved by the client, a sent quote accepted by the
 * client and its deposit paid, the Production and QC fee paid). Sets the deposit % to 30 and returns the value it had
 * before (restore it afterwards) and the drawing file paths (remove them with the Storage API afterwards).
 * T6: Shipment also needs the quote's balance (total − deposit) fully paid, so by default the balance invoice is issued
 * and its bank transfer recorded too (balance: 'paid'); pass balance: 'none' to leave it to the test (the T6 e2e).
 */
export async function advanceTurnkeyToProductionQc(o: { projectId: string; staff: string; customer: string; stamp: string; balance?: 'paid' | 'none' }) {
  const step = async (uid: string, aal: 'aal1' | 'aal2', sql: string, args: unknown[]) => {
    const db = pgClient();
    await db.connect();
    try {
      await assertStagingDatabase(db);
      await db.query('begin');
      await db.query('reset role');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal })]);
      await db.query('set local role authenticated');
      const r = (await db.query(sql, args)).rows[0]?.r;
      await db.query('commit');
      return r;
    } catch (e) {
      await db.query('rollback').catch(() => {});
      throw e;
    } finally {
      await db.end();
    }
  };
  const fee = async (stage: string, service: string, cents: number) => {
    await seedPaidTurnkeyFee({ projectId: o.projectId, stage, service, cents, proposer: o.staff, reference: `E2E-TK5-${stage}-${o.stamp}` });
    await moveTurnkeyStage(o.projectId, stage, o.staff);
  };
  await fee('consultation', 'consultation', 9900);
  await fee('design', 'layout_drawing', 29900);
  const path = `${o.projectId}/${crypto.randomUUID()}-e2e-layout.pdf`;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const up = await adminClient().storage.from('turnkey-drawings').upload(path, pdf, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`drawing upload: ${up.error.message}`);
  const v = await step(o.staff, 'aal2', `select tk_add_drawing_version($1, $2, 'layout.pdf', null) r`, [o.projectId, path]);
  const vid = (await step(o.staff, 'aal2', `select id r from tk_drawing_versions where project_id = $1 and version = $2`, [o.projectId, v.version])) as string;
  await step(o.customer, 'aal1', `select tk_decide_drawing($1, 'approve', null) r`, [vid]);
  await fee('sourcing', 'sourcing_quotes', 19900);
  const sys = pgClient();
  await sys.connect();
  let depositBefore: unknown = undefined;
  try {
    await assertStagingDatabase(sys);
    depositBefore = (await sys.query(`select value from site_settings where key = 'turnkey.deposit_pct'`)).rows[0]?.value;
  } finally { await sys.end(); }
  await step(o.staff, 'aal2', `select tk_set_deposit_pct(30) r`, []);
  const q = await step(o.staff, 'aal2', `select tk_save_client_quote($1, null, null, $2::jsonb) r`, [o.projectId, JSON.stringify([{ description: 'Commercial treadmill', qty: 2, unit_price_cents: 150000 }])]);
  await step(o.staff, 'aal2', `select tk_send_client_quote($1) r`, [q.id]);
  await moveTurnkeyStage(o.projectId, 'quote_deposit', o.staff);
  const acc = await step(o.customer, 'aal1', `select tk_decide_client_quote($1, 'accept', null) r`, [q.id]);
  await recordBankTransfer(acc.document_id, Number(acc.deposit_cents), `E2E-TK5-DEP-${o.stamp}`);
  await fee('production_qc', 'factory_audit', 25000);
  let balanceDocumentId: string | null = null;
  if ((o.balance ?? 'paid') === 'paid') {
    const b = await step(o.staff, 'aal2', `select tk_issue_balance_invoice($1) r`, [o.projectId]);
    balanceDocumentId = b.document_id as string;
    await recordBankTransfer(balanceDocumentId, Number(b.amount_cents), `E2E-TK5-BAL-${o.stamp}`);
  }
  return { depositBefore, drawingPaths: [path], balanceDocumentId };
}

/** Runs one statement as the given user (JWT claims, like PostgREST) in its own committed transaction; returns column r. */
async function stepAs(uid: string, aal: 'aal1' | 'aal2', sql: string, args: unknown[]) {
  const db = pgClient();
  await db.connect();
  try {
    await assertStagingDatabase(db);
    await db.query('begin');
    await asUser(db, uid);
    if (aal === 'aal1') await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aal: 'aal1' })]);
    const r = (await db.query(sql, args)).rows[0]?.r;
    await db.query('commit');
    return r;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

/**
 * T6: a passed, published pre-shipment inspection through the real T5 functions: a Turnkey editor plans it and sets the
 * fee (US$ 249, within 2×), Finance records the transfer, the editor schedules the inspector for today, the inspector
 * starts and submits a pass, and the editor (not the inspector) publishes it. `factory` is staff-only text.
 */
export async function passPreShipmentInspection(o: { projectId: string; staff: string; inspector: string; stamp: string; factory: string }) {
  const ins = await stepAs(o.staff, 'aal2', `select tk_create_inspection($1, 'pre_shipment', $2, null, null, $3::jsonb) r`, [o.projectId, o.factory, JSON.stringify(['Carton marks and labels', 'Function test'])]);
  const fee = await stepAs(o.staff, 'aal2', `select tk_propose_inspection_fee($1, 24900, null) r`, [ins.id]);
  await recordBankTransfer(fee.document_id as string, 24900, `E2E-TK6-PSI-${o.stamp}`);
  await stepAs(o.staff, 'aal2', `select tk_schedule_inspection($1, $2, current_date) r`, [ins.id, o.inspector]);
  await stepAs(o.inspector, 'aal2', `select tk_start_inspection($1) r`, [ins.id]);
  // read as the owner: inspectors see checklist lines only through the definer read of their own inspection
  const idb = pgClient(); await idb.connect();
  let items: string[] = [];
  try {
    await assertStagingDatabase(idb);
    items = (await idb.query(`select id from tk_inspection_items where inspection_id = $1 order by position`, [ins.id])).rows.map((r: { id: string }) => r.id);
  } finally { await idb.end(); }
  const report = { lot_size: 100, sample_size: 13, critical_defects: 0, major_defects: 0, minor_defects: 0, result: 'pass', remarks: null, signed_name: 'E2E TK6 Inspector',
    answers: items.map((id) => ({ item_id: id, answer: 'pass' })) };
  await stepAs(o.inspector, 'aal2', `select tk_submit_inspection($1, gen_random_uuid(), $2::jsonb) r`, [ins.id, JSON.stringify(report)]);
  await stepAs(o.staff, 'aal2', `select tk_publish_inspection($1, 'Passed: no defects found.', '{}') r`, [ins.id]);
  return { inspectionId: ins.id as string };
}

/** T6: reads one value as the given user (JWT claims) — used to prove what a customer or staff member can see. */
export async function readAs<T = unknown>(uid: string, aal: 'aal1' | 'aal2', sql: string, args: unknown[] = []): Promise<T> {
  return (await stepAs(uid, aal, sql, args)) as T;
}
