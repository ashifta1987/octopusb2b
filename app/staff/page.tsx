import { redirect } from 'next/navigation';

/** /staff → the workspace chooser (the proxy has already enforced sign-in + 2FA). */
export default function StaffIndex() {
  redirect('/staff/workspace');
}
