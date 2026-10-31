import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { can, type Session } from '@/lib/auth';
import { CatalogManager, type CatRow, type TagRow } from './catalog-manager';
import * as actions from './catalog-actions';

/** Loads categories (incl. hidden), tags and usage counts for the shared Catalog screen (Catalog.png). */
export async function CatalogScreen({ session }: { session: Session }) {
  const sb = await createClient();
  const [{ data: cats }, { data: tags }, { data: prods }, { data: pt }] = await Promise.all([
    sb.from('categories').select('id, name, slug, parent_id, level, hs_code, sort, active').order('sort'),
    sb.from('tags').select('id, name, kind').order('name'),
    sb.from('products').select('category_id').is('archived_at', null).neq('status', 'archived').limit(20000),
    sb.from('product_tags').select('tag_id').limit(50000),
  ]);
  const pc = new Map<string, number>();
  (prods ?? []).forEach((p) => p.category_id && pc.set(p.category_id, (pc.get(p.category_id) ?? 0) + 1));
  const tc = new Map<string, number>();
  (pt ?? []).forEach((t) => tc.set(t.tag_id, (tc.get(t.tag_id) ?? 0) + 1));
  return (
    <CatalogManager
      categories={(cats ?? []).map((c) => ({ ...c, products: pc.get(c.id) ?? 0 })) as CatRow[]}
      tags={(tags ?? []).map((t) => ({ ...t, products: tc.get(t.id) ?? 0 })) as TagRow[]}
      canEdit={can(session, 'catalog', 'edit')}
      actions={{
        createCategory: actions.createCategory, updateCategory: actions.updateCategory, moveCategory: actions.moveCategory,
        setCategoryActive: actions.setCategoryActive, mergeCategory: actions.mergeCategory, saveTag: actions.saveTag, deleteTag: actions.deleteTag,
      }}
    />
  );
}
