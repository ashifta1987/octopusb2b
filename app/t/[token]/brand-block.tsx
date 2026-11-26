import { createAdminClient } from '@/lib/supabase/server';

/**
 * Release 5 · Step 13 — the merchant's white-label brand on the buyer tracking page (screens/TrackPage.html: "merchant brand
 * only"). ds_public_brand(token) answers only for Octopus Dropship store orders: the APPROVED brand name, the logo when the
 * merchant chose to show it, the buyer returns policy and support email. Read on the server with the service role (the
 * function is not granted to anon or signed-in users). Never Octopus, a supplier or a warehouse name.
 * The logo lives in the private 'dropship-branding' bucket under a random file name; a 10-minute signed URL is made here.
 */
type Brand = { brand_name: string | null; logo_path: string | null; returns_policy: string | null; support_email: string | null } | null;

export async function BrandBlock({ token }: { token: string }) {
  // server-only read with the service role: ds_public_brand is not callable by anon / signed-in users
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('ds_public_brand', { p_token: token });
  const b = (error ? null : data) as Brand;
  if (!b || (!b.brand_name && !b.logo_path && !b.returns_policy && !b.support_email)) return null;
  let logo: string | null = null;
  if (b.logo_path) {
    try {
      const { data: signed } = await admin.storage.from('dropship-branding').createSignedUrl(b.logo_path, 600);
      logo = signed?.signedUrl ?? null;
    } catch {
      logo = null;
    }
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-3" aria-label="Seller" data-testid="tracking-brand">
      {(logo || b.brand_name) && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket */}
          {logo && <img src={logo} alt={b.brand_name ? `${b.brand_name} logo` : 'Seller logo'} className="h-10 w-auto max-w-[160px] object-contain" />}
          {b.brand_name && <strong className="text-base text-slate-900" data-testid="tracking-brand-name">{b.brand_name}</strong>}
        </div>
      )}
      {b.returns_policy && <p className="m-0 text-sm text-slate-800" data-testid="tracking-returns"><span className="font-semibold">Returns: </span>{b.returns_policy}</p>}
      {b.support_email && <p className="m-0 text-sm text-slate-800">Questions? <a href={`mailto:${b.support_email}`} className="text-blue-700 underline">{b.support_email}</a></p>}
    </section>
  );
}
