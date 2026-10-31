import AuthPage from '../auth-page';
export const metadata = { title: 'Log in' };
export default function Page(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return <AuthPage {...props} mode="login" />;
}
