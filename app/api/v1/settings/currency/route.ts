import { apiRoute } from '@/lib/api/handler';
import { json } from '@/lib/api/problem';
import { currencySettings, loadFx } from '@/lib/api/money';

/**
 * GET /api/v1/settings/currency — active platform currency and the approved USD→CNY rate (SPEC §15.1).
 * Subscribe to the `settings.currency_changed` webhook to hear about switches.
 */
export const GET = apiRoute({ scopes: ['catalog:read'] }, async ({ ctx }) => {
  return json({ data: currencySettings(await loadFx(ctx.sb)) });
});
