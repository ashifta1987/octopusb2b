// Down → up checks in the DB tests take one migration (or a chain) down and up again. Migrations applied AFTER the
// newest one a test knows about may build on the objects being dropped (e.g. 196's dropship_seller_profiles uses the
// division write guard from 192 and division_id_of from 189), so they are unwound first — newest first, with their own
// down files — and re-applied afterwards, in order. Everything still runs inside the caller's rolled-back transaction.
import fs from 'node:fs';

/** Applied migrations newer than `file` (by name), oldest first. */
export async function appliedAfter(db, file) {
  const applied = new Set((await db.query(`select name from public._migrations`)).rows.map((r) => r.name));
  return fs.readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql') && f > file && applied.has(f)).sort();
}

/** Runs the down files of `later` newest first. */
export async function unwind(db, later) {
  for (const f of [...later].reverse()) await db.query(fs.readFileSync(`supabase/migrations/down/${f.replace(/\.sql$/, '.down.sql')}`, 'utf8'));
}

/** Re-applies `later` oldest first. */
export async function reapply(db, later) {
  for (const f of later) await db.query(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));
}
