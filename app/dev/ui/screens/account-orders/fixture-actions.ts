'use server';

/**
 * Staging fixtures only: stand-ins for TODAY's server actions so the presentational My account commerce pages can render
 * with SAMPLE data. They never touch money or the database — every call answers "Sample only".
 */
import { isStaging } from '@/lib/core/account';

const MSG = 'Sample only — nothing was charged or sent.';
const no = () => {
  if (!isStaging()) throw new Error('Fixture action outside staging');
  return { ok: false as const, error: MSG };
};

export async function samplePayFromWallet(orderId: string) {
  void orderId;
  return no();
}
export async function sampleCancelOrder(orderId: string, reason?: string) {
  void orderId;
  void reason;
  return no();
}
export async function sampleStartOnlineCheckout(input: unknown) {
  void input;
  return no() as { ok: boolean; redirectUrl?: string; error?: string };
}
export async function samplePayWithProtection(input: unknown) {
  void input;
  return no() as { ok: boolean; error?: string };
}
export async function sampleOpenDispute(input: unknown) {
  void input;
  return no() as { ok: boolean; error?: string };
}
export async function sampleConfirmPayLater(input: unknown) {
  void input;
  return no() as { ok: boolean; status?: string; invoiceNumber?: string | null; netDays?: number; error?: string };
}
export async function sampleSubscribeSaas(input: { planCode: string; paymentOption: 'pay_now' | 'pay_later'; methodKind: 'card' | 'wallet' }) {
  void input;
  return no() as { ok: boolean; redirectUrl?: string; invoiceNumber?: string; error?: string };
}
export async function sampleApproveQuote(input: { quoteId: string }) {
  void input;
  return no();
}
export async function sampleRejectQuote(input: { quoteId: string; reason?: string }) {
  void input;
  return no();
}
export async function samplePostMessage(input: unknown) {
  void input;
  return no();
}
export async function sampleUploadFile(fd: FormData) {
  void fd;
  return no();
}
export async function sampleMarkQuotesViewed(rfqId: string) {
  void rfqId;
}
export async function sampleSubmitTransfer(input: { amountCents: number; slipPath: string; bankRef?: string }) {
  void input;
  return no();
}
export async function samplePayProforma(prev: { ok: boolean; message: string } | null, fd: FormData) {
  void prev;
  void fd;
  no();
  return { ok: false, message: MSG };
}
