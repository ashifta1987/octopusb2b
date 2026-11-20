// Shared guard for scripts that must only ever touch STAGING, plus the opposite guard for explicit --live scripts.
// Staging guard stops with an error unless ALL of these hold:
//   1. .env.staging (or staging .env.local) is loaded and says APP_ENVIRONMENT=staging
//   2. the Supabase URL is the staging project (project ref below) — and NOT the live project
//   3. the database connection string points at that same project
//   4. the database itself is marked staging (site_settings.app_environment)
// The live project ref is listed so a copy-paste of live settings into .env.staging / .env.local is refused too.
import fs from 'node:fs';
import { config } from 'dotenv';
export const STAGING_PROJECT_REF = 'ydbxqrizjxpduqbgnwxg';
export const LIVE_PROJECT_REF = 'qrawnqpxvtjmgncxmffu';

const refOf = (url) => { try { return new URL(url).hostname.split('.')[0]; } catch { return ''; } };
const die = (why, what = 'STAGING') => { console.error(`✘ refused: ${why} — this script only runs against the ${what} project.`); process.exit(1); };

/** Checks 1–3 on the CURRENT environment without loading anything or exiting: the reason it is not staging, or null. */
export function stagingEnvProblem(env = process.env) {
  const ref = refOf(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (env.APP_ENVIRONMENT !== 'staging') return 'APP_ENVIRONMENT is not "staging"';
  if (ref === LIVE_PROJECT_REF) return 'the Supabase URL is the LIVE project';
  if (ref !== STAGING_PROJECT_REF) return 'the Supabase URL is not the staging project';
  if (!(env.DATABASE_URL ?? '').includes(STAGING_PROJECT_REF)) return 'the database connection is not the staging project';
  return null;
}

/** Check 4 on an open pg client, without exiting: the reason it is not staging, or null. */
export async function stagingDatabaseProblem(db) {
  const env = (await db.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).rows[0]?.v;
  return env === 'staging' ? null : `the database is marked "${env ?? 'unset'}"`;
}

/** For test runners that must not call process.exit (Playwright): throws unless env AND database are staging. */
export async function assertStagingOrThrow(db) {
  const why = stagingEnvProblem() ?? (db ? await stagingDatabaseProblem(db) : null);
  if (why) throw new Error(`refused: ${why} — this test only runs against the STAGING project.`);
}

/** Loads .env.staging into process.env and checks 1–3. Call before connecting. */
export function loadStagingEnvOrExit() {
  config({ path: '.env.staging', quiet: true, override: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ref = refOf(url);
  if (process.env.APP_ENVIRONMENT !== 'staging') die('APP_ENVIRONMENT is not "staging"');
  if (ref === LIVE_PROJECT_REF) die('the Supabase URL is the LIVE project');
  if (ref !== STAGING_PROJECT_REF) die('the Supabase URL is not the staging project');
  if (!(process.env.DATABASE_URL ?? '').includes(STAGING_PROJECT_REF)) die('the database connection is not the staging project');
}

/** Check 4, on an open pg client. */
export async function assertStagingDatabase(db) {
  const env = (await db.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).rows[0]?.v;
  if (env !== 'staging') die(`the database is marked "${env ?? 'unset'}"`);
}

/** Opposite check for LIVE: requires explicit --live flag + live project URL/DB (never staging). */
export function liveEnvProblem(env = process.env, argv = process.argv) {
  if (!argv.includes('--live')) return 'pass --live explicitly to load .env.live and access the LIVE project';
  if (argv.includes('--staging')) return 'cannot pass both --live and --staging';
  const ref = refOf(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (env.APP_ENVIRONMENT === 'staging') return 'APP_ENVIRONMENT is "staging"';
  if (ref === STAGING_PROJECT_REF) return 'the Supabase URL is the STAGING project';
  if (ref !== LIVE_PROJECT_REF) return 'the Supabase URL is not the live project';
  if (!(env.DATABASE_URL ?? '').includes(LIVE_PROJECT_REF)) return 'the database connection is not the live project';
  if ((env.DATABASE_URL ?? '').includes(STAGING_PROJECT_REF)) return 'the database connection points at STAGING';
  return null;
}

/** Loads .env.live into process.env ONLY when --live is passed, and verifies it is the LIVE project. */
export function loadLiveEnvOrExit(argv = process.argv) {
  if (!argv.includes('--live')) die('pass --live explicitly to load .env.live', 'LIVE (--live)');
  if (!fs.existsSync('.env.live')) die('.env.live file is missing', 'LIVE');
  config({ path: '.env.live', quiet: true, override: true });
  const why = liveEnvProblem(process.env, argv);
  if (why) die(why, 'LIVE');
}

/** Checks that an open pg client is marked production. */
export async function assertLiveDatabase(db) {
  const env = (await db.query(`select value #>> '{}' v from site_settings where key = 'app_environment'`)).rows[0]?.v;
  if (env !== 'production') die(`the database is marked "${env ?? 'unset'}"`, 'LIVE');
}
