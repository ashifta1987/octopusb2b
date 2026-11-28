// ODS T9 · Catalogue › Categories & tags. Replaces the T8 re-export of app/admin/catalog/page.tsx inside the ODS Back Office
// frame. Same guard (requireStaff('catalog','view')), the same reads as today's CatalogScreen (categories incl. hidden, tags,
// product / tag usage counts), today's catalog actions unchanged (components/backoffice/catalog-actions); editing with
// catalog:edit, as today.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import * as catalogActions from '@/components/backoffice/catalog-actions';
import type { CatRow, TagRow } from '../_catalogue/core';
import { CatalogScreen } from './_components/catalog-screen';

export const metadata = { title: 'Categories & tags' };

const ACTIONS = {
  createCategory: catalogActions.createCategory, updateCategory: catalogActions.updateCategory, moveCategory: catalogActions.moveCategory,
  setCategoryActive: catalogActions.setCategoryActive, mergeCategory: catalogActions.mergeCategory, saveTag: catalogActions.saveTag, deleteTag: catalogActions.deleteTag,
};

async function CatalogContent() {
  const s = await requireStaff('catalog', 'view', '/admin/catalog');
  const sb = await createClient();
  const [{ data: cats }, { data: tags }, { data: prods }, { data: pt }] = await Promise.all([
    sb.from('categories').select('id, name, slug, parent_id, level, hs_code, sort, active').order('sort'),
    sb.from('tags').select('id, name, kind').order('name'),
    sb.from('products').select('category_id').is('archived_at', null).neq('status', 'archived').limit(20000),
    sb.from('product_tags').select('tag_id').limit(50000),
  ]);
  const pc = new Map<string, number>();
  (prods ?? []).forEach((p) => p.category_id && pc.set(p.category_id as string, (pc.get(p.category_id as string) ?? 0) + 1));
  const tc = new Map<string, number>();
  (pt ?? []).forEach((t) => tc.set(t.tag_id as string, (tc.get(t.tag_id as string) ?? 0) + 1));
  return (
    <CatalogScreen
      state="ok"
      categories={(cats ?? []).map((c) => ({ ...c, products: pc.get(c.id as string) ?? 0 })) as CatRow[]}
      tags={(tags ?? []).map((t) => ({ ...t, products: tc.get(t.id as string) ?? 0 })) as TagRow[]}
      canEdit={can(s, 'catalog', 'edit')}
      actions={ACTIONS}
    />
  );
}

export default function AdminCatalogPage() {
  return (
    <Suspense fallback={<CatalogScreen state="loading" categories={[]} tags={[]} canEdit={false} actions={ACTIONS} />}>
      <CatalogContent />
    </Suspense>
  );
}
