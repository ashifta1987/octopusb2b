import { describe, expect, it } from 'vitest';
import {
  LIVE_PROJECT_REF,
  STAGING_PROJECT_REF,
  liveEnvProblem,
  stagingEnvProblem,
} from '../../scripts/lib-staging-guard.mjs';

const stagingEnv = {
  APP_ENVIRONMENT: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  DATABASE_URL: `postgresql://postgres:x@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`,
};

const liveEnv = {
  APP_ENVIRONMENT: 'production',
  NEXT_PUBLIC_SUPABASE_URL: `https://${LIVE_PROJECT_REF}.supabase.co`,
  DATABASE_URL: `postgresql://postgres:x@db.${LIVE_PROJECT_REF}.supabase.co:5432/postgres`,
};

describe('staging vs --live environment guards', () => {
  it('stagingEnvProblem accepts staging and refuses live', () => {
    expect(stagingEnvProblem(stagingEnv)).toBeNull();
    expect(stagingEnvProblem(liveEnv)).toMatch(/staging/i);
    expect(stagingEnvProblem({ ...stagingEnv, NEXT_PUBLIC_SUPABASE_URL: liveEnv.NEXT_PUBLIC_SUPABASE_URL })).toMatch(/LIVE/);
    expect(stagingEnvProblem({ ...stagingEnv, DATABASE_URL: liveEnv.DATABASE_URL })).toMatch(/staging/i);
  });

  it('liveEnvProblem refuses without --live, refuses staging, and accepts live with --live', () => {
    expect(liveEnvProblem(liveEnv, ['node', 'script.mjs'])).toMatch(/--live/);
    expect(liveEnvProblem(liveEnv, ['node', 'script.mjs', '--live', '--staging'])).toMatch(/both/);
    expect(liveEnvProblem(stagingEnv, ['node', 'script.mjs', '--live'])).toMatch(/staging/i);
    expect(liveEnvProblem({ ...liveEnv, DATABASE_URL: stagingEnv.DATABASE_URL }, ['node', 'script.mjs', '--live'])).toMatch(/live/i);
    expect(liveEnvProblem(liveEnv, ['node', 'script.mjs', '--live'])).toBeNull();
  });
});
