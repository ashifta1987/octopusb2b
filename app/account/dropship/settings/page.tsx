import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSettingsPage, type SettingsPageData } from '@/lib/dropship-ds12';
import { getDropshipFeatures } from '@/lib/dropship-features';
import { COUNTRY_NAMES } from '@/lib/format';
import { SettingsClient } from './settings-client';

export const metadata = { title: 'Settings · Octopus Dropship' };

/**
 * Release 5 · Step 13 — Settings (screens/Settings.html, mobile/M_Settings.html). Data: ds_settings_page() — profile (time
 * zone), team and Dropship roles (checked in the database for every action), invitations, my notification choices (email is
 * stored and starts once app email is live; nothing is sent before), branding for packing slips and the tracking page
 * (white-label: brand name from the approved seller profile, optional logo), buyer policies, data export, close Dropshipping.
 */
async function Settings() {
  await requireDropshipV2Merchant('/account/dropship/settings');
  let data: SettingsPageData | null = null;
  let error: string | null = null;
  try {
    data = await getSettingsPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="dropship-settings-page">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Settings</h1>
        <DsNotice tone="bad" title="Settings could not be loaded" testId="settings-error"
          action={<DsLinkButton href="/account/dropship/settings" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const features = await getDropshipFeatures();
  return (
    <SettingsClient
      data={data}
      countryName={data.org.country ? COUNTRY_NAMES[data.org.country] ?? data.org.country : null}
      emailLive={Boolean(process.env.RESEND_API_KEY)}
      ordersOn={features.orders}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="settings-loading"><DsSkeleton immediate /></div>}>
      <Settings />
    </Suspense>
  );
}
