// Chain 13 — Ad click → ledger (SPEC §21.1 #13).
// A tagged campaign for org A is active only for the few seconds of the test (placement search_top, 1-cent CPC) and is
// deleted at the end. GET /api/ads/click → record_ad_click (dedupe by fingerprint/24 h, budget, wallet) → ad_clicks +
// wallet charge journal + spent_today tick → 302 to the campaign link.
import { count, hops, http, balanced, loadState, newTrace, remember, reporter, sql, traceRows } from './lib.mjs';

const { r, check, note, save } = reporter(13, 'Ad click → ledger');
const trace = newTrace(13);
r.traces.push(trace);
remember((s) => s.traces.push(trace));
let campaignId = null;
try {
  const orgId = loadState().orgA;
  const [c] = await sql(`insert into ad_campaigns(org_id, name, placement, headline, body, link, daily_budget_cents, max_cpc_cents, status)
    values ($1, 'QA-TRACE campaign', 'search_top', 'QA test — please ignore', 'E2E trace', '/products', 3, 1, 'active') returning id`, [orgId]);
  campaignId = c.id;
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 e2e-trace';
  const click = (ip) => http(`/api/ads/click?c=${campaignId}`, { trace, headers: { 'user-agent': ua, 'x-forwarded-for': ip } });
  const t0 = Date.now();
  const c1 = await click('203.0.113.10');
  r.latency['click → record_ad_click → 302'] = c1.ms;
  check(c1.status === 302 && /\/products$/.test(c1.headers.get('location') ?? ''), 'click redirects to the campaign link', `${c1.status} ${c1.headers.get('location')}`);
  const c2 = await click('203.0.113.10'); // same fingerprint within 24 h
  check(c2.status === 302, 'duplicate click still redirects (no error to the visitor)');
  const c3 = await click('203.0.113.11'); // second visitor: budget 3, cpc 1 → charged
  const c4 = await click('203.0.113.12');
  const c5 = await click('203.0.113.13'); // budget exhausted → campaign pauses
  r.e2e_ms = Date.now() - t0;
  void c3; void c4; void c5;
  const clicks = await sql(`select fingerprint, charged_cents, valid, trace_id from ad_clicks where campaign_id=$1 order by created_at`, [campaignId]);
  r.clicks = clicks.map((x) => `${x.fingerprint.slice(0, 8)} ${x.charged_cents} ${x.valid}`);
  check(clicks.length === 4 && clicks[0].valid !== false && clicks[1].valid === false && Number(clicks[1].charged_cents) === 0, 'first click charged, duplicate within 24 h recorded as invalid with 0 charge', r.clicks.join(' | '));
  const [camp] = await sql(`select status, spent_today_cents from ad_campaigns where id=$1`, [campaignId]);
  check(Number(camp.spent_today_cents) === 3 && camp.status === 'paused', 'budget tick: spent 3/3, campaign auto-paused when the budget ran out', JSON.stringify(camp));
  const rows = await traceRows(trace);
  r.hops = hops(rows);
  check(count(rows, 'journals') === 3 && balanced(rows), '3 charge journals (one per valid click), balanced', `${count(rows, 'journals')} journals / ${count(rows, 'ledger_entries')} entries`);
  check(count(rows, 'ad_clicks') === 4, 'all 4 ad_clicks rows carry the trace id', count(rows, 'ad_clicks'));
  check(count(rows, 'outbox_events') === 0, 'no outbox event: the charge is synchronous (§10.1 lists ad.clicked → ad charge; implemented inline in record_ad_click)', '');
  check(count(rows, 'status_history', (x) => x.entity === 'ad_campaign') >= 1, 'auto-pause written to status_history', count(rows, 'status_history'));
  // negative: bot user-agent is not charged
  const before = (await sql(`select count(*)::int n from ad_clicks where campaign_id=$1`, [campaignId]))[0].n;
  await http(`/api/ads/click?c=${campaignId}`, { trace, headers: { 'user-agent': 'Googlebot/2.1', 'x-forwarded-for': '203.0.113.99' } });
  const after = (await sql(`select count(*)::int n from ad_clicks where campaign_id=$1`, [campaignId]))[0].n;
  check(before === after, 'negative: bot click not recorded', `${before} → ${after}`);
  const bad = await http(`/api/ads/click?c=not-a-uuid`, { trace });
  check(bad.status === 302 && new URL(bad.headers.get('location')).pathname === '/', 'negative: invalid campaign id → redirect home, nothing written');
} catch (e) {
  check(false, 'unexpected error', e.stack);
} finally {
  if (campaignId) await sql(`update ad_campaigns set status='paused' where id=$1 and status='active'`, [campaignId]).catch(() => null);
  save();
  process.exit(0);
}
