import { z } from 'zod';

/** Group-buy form schemas — the SAME schema runs in the client form and in the server action (SPEC §18). */

export const newAddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  line1: z.string().trim().min(3, 'Enter the street address').max(200),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  postal_code: z.string().trim().max(20).optional(),
  country: z.string().trim().regex(/^[A-Z]{2}$/, 'Choose a country'),
});

const paySource = z.enum(['wallet', 'card']);
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, 'Invalid id');

/** Join form. `minPledge` comes from the pool. Address: an existing id, a new address, or none. */
export function joinSchema(minPledge: number) {
  return z.object({
    poolId: uuid,
    qty: z.coerce.number({ message: 'Enter a quantity' }).int('Whole units only').min(minPledge, `Minimum pledge is ${minPledge.toLocaleString('en-US')}`).max(10_000_000),
    addressId: z.union([uuid, z.literal(''), z.literal('new')]).optional(),
    newAddress: newAddressSchema.optional(),
    paySource,
    terms: z.literal(true, { message: 'Please agree to the Group Buy Terms' }),
    termsId: uuid.nullable().optional(),
  }).refine((v) => v.addressId !== 'new' || !!v.newAddress, { message: 'Enter the new address', path: ['newAddress'] });
}
export type JoinInput = z.infer<ReturnType<typeof joinSchema>>;

export function startSchema(o: { moq: number; minDays: number; maxDays: number }) {
  return z.object({
    productId: uuid,
    targetQty: z.coerce.number().int().min(o.moq, `Target must be at least the MOQ (${o.moq.toLocaleString('en-US')})`).max(100_000_000),
    days: z.coerce.number().int().min(o.minDays, `At least ${o.minDays} days`).max(o.maxDays, `At most ${o.maxDays} days`),
    minPledge: z.coerce.number().int().min(1, 'At least 1').max(100_000_000),
    qty: z.coerce.number().int().min(1, 'Enter your pledge'),
    addressId: z.union([uuid, z.literal(''), z.literal('new')]).optional(),
    newAddress: newAddressSchema.optional(),
    paySource,
    terms: z.literal(true, { message: 'Please agree to the Group Buy Terms' }),
  })
    .refine((v) => v.qty >= v.minPledge, { message: 'Your pledge must be at least the minimum pledge', path: ['qty'] })
    .refine((v) => v.minPledge <= v.targetQty, { message: 'Minimum pledge cannot exceed the target', path: ['minPledge'] })
    .refine((v) => v.addressId !== 'new' || !!v.newAddress, { message: 'Enter the new address', path: ['newAddress'] });
}
export type StartInput = z.infer<ReturnType<typeof startSchema>>;
