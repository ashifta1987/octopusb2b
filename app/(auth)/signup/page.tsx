import AuthPage from '../auth-page';
export const metadata = { title: 'Create account' };
export default function Page(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return <AuthPage {...props} mode="signup" />;
}
