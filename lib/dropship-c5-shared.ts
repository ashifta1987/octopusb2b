/** CONN S5 · client-safe health types and words (the server getter is lib/dropship-c5.ts). */
export type StoreCarrierHealth = {
  can_edit: boolean; checked_at: string;
  connections: { id: string; merchant: string; org_id: string; platform: string; shop: string; status: string; last_error: string | null; at: string | null; last_sync_at: string | null }[];
  failed_tasks: { id: string; merchant: string; platform: string; order_number: string; external_order_name: string | null; action: string; attempts: number; last_error: string | null; created_at: string }[];
  carriers: {
    id: string; warehouse_code: string; carrier: 'yunexpress' | '4px'; name: string; mode: 'sandbox' | 'live'; active: boolean;
    last_check_at: string | null; last_check_ok: boolean | null; last_check_message: string | null; failures_24h: number; last_error: string | null; last_error_at: string | null;
  }[];
};

export const TASK_LABEL: Record<string, string> = {
  send_tracking: 'Send tracking', update_tracking: 'Update tracking', release_fulfillment: 'Release fulfilment',
  accept_cancellation: 'Accept cancellation', reject_cancellation: 'Reject cancellation',
};
