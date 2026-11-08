import { Suspense } from 'react';
import AuthPage from '../auth-page';
export const metadata = { title: 'Create account' };
export default function Page(props: { searchParams: Promise<{ next?: string; error?: string; service?: string }> }) {
  return <Suspense fallback={<div className="min-h-screen bg-ink" />}><AuthPage {...props} mode="signup" /></Suspense>;
}
