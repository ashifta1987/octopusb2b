import { StaffFrame } from '../_components/frame';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Forgot password · Staff' };

/** Staff password reset request (SPEC §17.3 "Reset"). */
export default function StaffForgotPage() {
  return (
    <StaffFrame step={0}>
      <ForgotForm />
    </StaffFrame>
  );
}
