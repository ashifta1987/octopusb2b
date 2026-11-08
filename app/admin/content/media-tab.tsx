import Image from 'next/image';
import { Card } from '@/components/ui';
import { ActionForm } from '@/components/admin/client';
import { createClient } from '@/lib/supabase/server';
import { saveSiteMedia } from './media-actions';

const publicUrl = (path: string) => `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/storage/v1/object/public/site-media/${path}`;

/** Site content › Media (brand kit step 4): every picture slot, its file and alt text; swap without a deploy. */
export async function MediaTab({ editable }: { editable: boolean }) {
  const sb = await createClient();
  const { data, error } = await sb.from('site_media').select('key, label, default_src, path, alt, width, height, updated_at').order('sort');
  if (error) throw new Error(`Could not load the picture slots: ${error.message}`);
  return (
    <div className="space-y-4" data-testid="media-tab">
      <p className="text-[14px] text-muted max-w-[760px]">Each slot is a Site content key. Upload a new picture (WebP, 1200 × 800, 3:2) or change the alt text; the site updates within a minute. Alt text describes what the picture shows; never staff names. &ldquo;Reset&rdquo; goes back to the picture shipped with the site.</p>
      <ul className="grid gap-4 md:grid-cols-2">
        {(data ?? []).map((m) => {
          const src = m.path ? publicUrl(m.path as string) : (m.default_src as string);
          return (
            <li key={m.key as string}>
              <Card className="p-4 h-full">
                <div className="flex gap-4">
                  <div className="relative w-[150px] shrink-0 aspect-[3/2] rounded-[10px] overflow-hidden bg-ill-bg border border-line">
                    <Image src={src} alt={(m.alt as string) || ''} fill sizes="150px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{m.label as string}</div>
                    <div className="mono text-[12px] text-muted break-all">{m.key as string}</div>
                    <div className="text-[12px] text-muted mt-1">{m.path ? `Media store · ${(m.path as string).split('/').slice(-1)[0]}` : 'Picture shipped with the site'}</div>
                  </div>
                </div>
                {editable ? (
                  <ActionForm action={saveSiteMedia} className="mt-3 grid gap-2" submitLabel="Save picture" submitClass="btn btn-primary btn-sm">
                    <input type="hidden" name="key" value={m.key as string} />
                    <label className="label !mb-0" htmlFor={`alt-${m.key}`}>Alt text</label>
                    <input id={`alt-${m.key}`} name="alt" defaultValue={m.alt as string} className="input" placeholder="What the picture shows" />
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                      <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" name="decorative" defaultChecked={!m.alt} className="w-4 h-4" />Decorative (no alt text)</label>
                      {m.path && <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" name="reset" className="w-4 h-4" />Reset to the shipped picture</label>}
                    </div>
                    <label className="label !mb-0" htmlFor={`file-${m.key}`}>Replace picture</label>
                    <input id={`file-${m.key}`} name="file" type="file" accept="image/webp,image/jpeg,image/png,image/avif" className="text-[13px] min-h-11" />
                  </ActionForm>
                ) : (
                  <p className="mt-3 text-[13px] text-black">{(m.alt as string) || 'Decorative (no alt text)'}</p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
