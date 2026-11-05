import { redirect } from 'next/navigation';

/**
 * ADDON-23: advertising is not part of the customer account (SPEC §3 — only suppliers, distributors, the Advertiser
 * role and admin advertise). Anyone typing /account/ads lands on the dashboard with a one-line notice.
 * The campaign screen is kept in ./campaign-manager.tsx for the future supplier portal.
 */
export default function AdsRedirect(): never {
  redirect('/account?notice=not-in-account');
}
