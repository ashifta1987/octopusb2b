import { Suspense } from 'react';
import AuthPage from '../auth-page';
export const metadata = { title: 'Customer log in', description: 'Log in to Octopus B2B to request quotes, manage orders, check your wallet and track shipments.', alternates: { canonical: '/login' } };
export default function Page(props: { searchParams: Promise<{ next?: string; error?: string; service?: string }> }) {
  return <Suspense fallback={<div className="min-h-screen bg-pearl" />}><AuthPage {...props} mode="login" /></Suspense>;
}
