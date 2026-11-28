/** ODS T9 · Orders — view models shared by the server loaders, the client screens and the fixtures (types only). */
import type { OrderRow, OrderTab } from './order-core';

export type CountFigure = number | { error: string };
export type OrderKpis = { active: CountFigure; awaiting: CountFigure; production: CountFigure; ready: CountFigure; disputed: CountFigure };

export type OrderListData = {
  rows: OrderRow[];
  total: number;
  counts: Partial<Record<OrderTab, number>>;
  kpis: OrderKpis;
  updatedAt: string;
  /** every row on the page is USD (grid shows plain figures with "US$" in the header) */
  allUsd: boolean;
  /** Supplier column is built (admin / suppliers:view / finance:view, as today) */
  supplierColumn: boolean;
};

export type OrderDocVM = { id: string; number: string; type: string; supplier: boolean; amountMinor: number | null; currency: string | null; status: string | null; createdAt: string };
export type OrderPaymentVM = { id: string; purpose: string; method: string; amountMinor: number; currency: string; reference: string | null; status: string; createdAt: string };
export type OrderShipmentVM = { id: string; code: string | null; trackingNo: string | null; status: string; carrier: string | null; serviceCode: string | null; labelUrl: string | null; packingSlip: boolean; createdAt: string };
export type OrderEventVM = { id: string; kind: string | null; title: string; body: string | null; createdAt: string };
export type OrderTicketVM = { id: string; code: string; subject: string; status: string; priority: string; updatedAt: string };

export type OrderRecordData = {
  id: string;
  code: string;
  title: string;
  status: string;
  service: string;
  customer: { id: string; name: string; country: string | null; city: string | null; kycStatus: string | null } | null;
  quantity: number | null;
  unitPriceMinor: number | null;
  shippingMinor: number | null;
  totalMinor: number;
  depositMinor: number;
  depositPct: number | null;
  paidMinor: number;
  balanceMinor: number;
  depositDueMinor: number;
  currency: string;
  incoterm: string | null;
  quoteCode: string | null;
  rfqCode: string | null;
  createdAt: string;
  deliveredAt: string | null;
  claimVisibleUntil: string | null;
  claimHiddenUntil: string | null;
  /** only with the supplier permission */
  supplier: { code: string | null; legalName: string | null; country: string | null } | null;
  /** null = this panel failed to load */
  documents: OrderDocVM[] | null;
  supplierDocsHidden: boolean;
  payments: OrderPaymentVM[] | null;
  shipments: OrderShipmentVM[] | null;
  events: OrderEventVM[] | null;
  /** 'restricted' = no support:view */
  tickets: OrderTicketVM[] | null | 'restricted';
  /** mfa_fresh() for Finance (false → "confirm with your code" before recording), null for others */
  payFresh: boolean | null;
};
