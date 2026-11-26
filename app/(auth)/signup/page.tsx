import { Suspense } from 'react';
import AuthPage from '../auth-page';
export const metadata = { title: 'Create a free account', description: 'Create a free Octopus B2B account to request quotes, see tier prices, place orders and track shipments.', alternates: { canonical: '/signup' } };
export default function Page(props: { searchParams: Promise<{ next?: string; error?: string; service?: string }> }) {
  return <Suspense fallback={<div className="min-h-screen bg-pearl" />}><AuthPage {...props} mode="signup" /></Suspense>;
}
