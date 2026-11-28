/**
 * View models for the ODS Shop catalogue (client-safe; what the presentational components get as props).
 * Money is in MINOR units (cents) of `currency`; components divide by 100 for <Money>. Nothing here can carry a
 * supplier/factory name or code, a model number, cost or margin (Part 1 rule 7).
 */
import type { ProductCardImage } from '@octopus/ui';
import type { SourcingCardModel } from '../../_lib/cards';
import type { PriceTier } from './price';

export type CategoryOption = { slug: string; name: string; level: number; count: number };

export type ProductListVM = {
  /** FRAME builder's card models (app/ods/shop/_lib/cards toSourcingCard), rendered with <ShopCard>. */
  items: SourcingCardModel[];
  total: number;
  page: number;
  pages: number;
  /** Platform currency label for <Money>, e.g. "US$". */
  currency: string;
};

export type CustomiseOption = { value: string; label: string; minimum: string; description: string };
export type ProductQuestion = { q: string; a: string };

export type ProductPageVM = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  images: ProductCardImage[];
  verified: boolean;
  customisable: boolean;
  /** The sample service is on and the product isn't tagged `no-samples` (samplesAvailableFor, owner decision 4). */
  samplesAvailable: boolean;
  unit: string;
  unitPlural: string;
  moq: number;
  leadDays: number | null;
  tiers: PriceTier[];
  currency: string;
  /** Sample fee in cents (0 = free); null = not set / sample service off. */
  sampleCents: number | null;
  shipsFrom: string;
  /** Sea / air estimate text from rate cards; null = "Quoted at order". */
  shippingEstimate: { sea: string | null; air: string | null } | null;
  shippingNotes: string[];
  incoterm: string | null;
  hsCode: string | null;
  hsIndicative: boolean;
  packing: string | null;
  specs: { name: string; value: string }[];
  breadcrumbs: { label: string; href?: string }[];
  categoryId: string | null;
  pool: { code: string } | null;
  customise: CustomiseOption[];
  questions: ProductQuestion[];
};

/** What the signed-in member may do + defaults for the forms. */
export type ShopActor = { canAct: boolean; reason: string | null; country: string | null; cartCount: number };

export type ActionFail = { ok: false; error: string; field?: string };
export type AddToCartFn = (productId: string, quantity?: number) => Promise<{ ok: true; count: number } | ActionFail>;
export type SubmitRfqFn = (input: {
  productId: string;
  quantity: number;
  targetPrice: string;
  country: string;
  city: string;
  customisation: string[];
  notes: string;
  idem: string;
}) => Promise<{ ok: true; id: string; code: string } | ActionFail>;
export type SubmitSampleFn = (input: {
  productId: string;
  productTitle: string;
  quantity: number;
  country: string;
  city: string;
  notes: string;
  idem: string;
}) => Promise<{ ok: true; id: string; code: string | null } | ActionFail>;
export type LoadSimilarFn = (productId: string, categoryId: string | null) => Promise<{ items: SourcingCardModel[] } | { error: string }>;
