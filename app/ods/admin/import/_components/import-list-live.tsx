'use client';

import { createClient } from '@/lib/supabase/client';
import { createImportUploads, stageImportRun } from '@/app/admin/import/actions';
import { ImportListScreen, type ImportListProps } from './import-list';

/** Live wiring for the Bulk import screen: today's two server actions + today's browser upload to the signed URL. */
export function ImportListLive(props: Omit<ImportListProps, 'actions'>) {
  return (
    <ImportListScreen
      {...props}
      actions={{
        createUploads: createImportUploads,
        stage: stageImportRun,
        uploadFile: async (path, token, file) => {
          const { error } = await createClient().storage.from('imports').uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
          return { error: error ? error.message : null };
        },
      }}
    />
  );
}
