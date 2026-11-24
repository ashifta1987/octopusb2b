import { Suspense } from 'react';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import type { SourcingCandidateOption } from '../actions';
import { DropshipCsvImportClient, type ImportJobSummary } from './import-client';

export const metadata = { title: 'Import products · Dropshipping · Back office' };

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6 animate-pulse">Loading import workspace…</div>}>
      <CsvImportPage />
    </Suspense>
  );
}

async function CsvImportPage() {
  const staff = await requireDropshipStaff(true);
  const sb = await createClient();

  const [candsRes, jobsRes] = await Promise.all([
    staff.canSeeCosts
      ? sb.rpc('list_sourcing_candidates_for_dropship', { p_limit: 80 })
      : Promise.resolve({ data: [] }),
    staff.canSeeCosts
      ? sb
          .from('dropship_import_jobs')
          .select(
            'id, job_code, source_type, file_name, status, total_rows, created_count, updated_count, unchanged_count, error_count, created_at',
          )
          .order('created_at', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
  ]);

  const candidates = ((candsRes.data ?? []) as SourcingCandidateOption[]).map((c) => ({
    ...c,
    unit_cost_cents: Number(c.unit_cost_cents ?? 0),
  }));

  const recentJobs: ImportJobSummary[] = (jobsRes.data ?? []).map((j) => ({
    id: String(j.id),
    job_code: String(j.job_code),
    source_type: String(j.source_type),
    file_name: j.file_name ? String(j.file_name) : null,
    status: String(j.status),
    total_rows: Number(j.total_rows ?? 0),
    created_count: Number(j.created_count ?? 0),
    updated_count: Number(j.updated_count ?? 0),
    unchanged_count: Number(j.unchanged_count ?? 0),
    error_count: Number(j.error_count ?? 0),
    created_at: String(j.created_at),
  }));

  return (
    <DropshipCsvImportClient
      candidates={candidates}
      recentJobs={recentJobs}
      canSeeCosts={staff.canSeeCosts}
    />
  );
}
