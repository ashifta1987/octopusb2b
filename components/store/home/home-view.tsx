import { GridSkeleton } from '@/components/store/product-card';
import { FinalHome } from './final';

/** Storefront home — brand kit step 5 (ADDON-48 final layout, owner's order). The previous Nov 2026 layout
 *  (components/store/home/v2.tsx) is kept for reference but no longer rendered. */
export async function HomeView() {
  return <FinalHome />;
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-pearl h-[380px]" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-12 space-y-16">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card h-[72px]" />)}</div>
        <GridSkeleton n={4} />
      </div>
    </div>
  );
}
