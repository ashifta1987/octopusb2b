import { ServiceStart } from '@/components/account/service-start';

export const metadata = { title: '3PL warehouse' };

export default function Page() {
  return <ServiceStart service="warehouse" />;
}
