'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const KycInput = z.object({
  company: z.string().trim().min(2, 'Enter the legal company name').max(200),
  regNo: z.string().trim().min(2, 'Enter the company registration number').max(100),
  businessType: z.string().trim().min(1, 'Choose a business type').max(100),
  website: z.string().trim().max(300).optional().default(''),
  country: z.string().trim().length(2, 'Choose a country'),
  region: z.string().trim().min(1, 'Enter the state / province / region').max(100),
  city: z.string().trim().min(1, 'Enter the city').max(100),
  postal: z.string().trim().min(1, 'Enter the postal code').max(30),
  line1: z.string().trim().min(2, 'Enter address line 1').max(300),
  line2: z.string().trim().max(300).optional().default(''),
  contactName: z.string().trim().min(2, 'Enter the contact person’s full name').max(200),
  contactEmail: z.string().trim().email('Enter a valid work email'),
  contactPhone: z.string().trim().min(5, 'Enter a phone number').max(40),
  consent: z.literal(true, { message: 'Please confirm the details and accept the Privacy Policy' }),
});
export type KycInput = z.input<typeof KycInput>;

/** Address stored on the submission as readable lines (parsed back best-effort to prefill the form). */
function formatAddress(i: z.output<typeof KycInput>, countryName: string) {
  return [i.line1, i.line2, `${i.city}, ${i.region}, ${i.postal}`, countryName].join('\n');
}

export async function submitKyc(
  input: KycInput,
  countryName: string,
): Promise<ActionResult<{ submission_id: string; org_id: string }>> {
  const parsed = KycInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form' };
  const s = await getSession();
  if (!s?.org) return { ok: false, error: mapDbError({ message: 'NO_ORG' }) };
  const i = parsed.data;
  const sb = await createClient();
  const { data, error } = await sb.rpc('submit_kyc', {
    p_company: i.company,
    p_reg_no: i.regNo,
    p_address: formatAddress(i, countryName),
    p_contact: i.contactName,
    p_phone: i.contactPhone,
    p_email: i.contactEmail,
  });
  if (error) return { ok: false, error: mapDbError(error) };

  // Optional profile fields on the organization (RLS allows own-org updates; kyc_status is trigger-guarded).
  const website = i.website && !/^https?:\/\//i.test(i.website) ? `https://${i.website}` : i.website || null;
  await sb.from('organizations').update({ business_type: i.businessType, website, country: i.country, city: i.city }).eq('id', s.org.id);

  revalidatePath('/account/kyc');
  revalidatePath('/account');
  return { ok: true, data: { submission_id: data as string, org_id: s.org.id } };
}
