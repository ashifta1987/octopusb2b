import { Card, ErrorState, ProductCardSkeleton, Skeleton } from '@octopus/ui';

/** Product page loading skeleton (Suspense fallback + fixture). One "Loading product" status. */
export function ProductPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-ods-content flex-col gap-6 px-ods-pad-page py-6" aria-busy="true" data-testid="product-page-loading">
      <Skeleton silent className="h-4 w-64 max-w-full" />
      <div className="grid gap-8 ods-desktop:grid-cols-2">
        <Skeleton silent className="aspect-[4/3] w-full rounded-ods-card" />
        <div className="flex flex-col gap-4">
          <Skeleton silent className="h-5 w-48" />
          <Skeleton silent className="h-8 w-4/5" />
          <Skeleton silent lines={3} />
          <Skeleton silent className="h-40 w-full rounded-ods-card" />
          <Skeleton label="Loading product" className="h-ods-control w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 ods-tablet:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <ProductCardSkeleton key={i} silent />
        ))}
      </div>
    </div>
  );
}

/** Product page failed to load (the frame keeps working). */
export function ProductPageError({ retryHref }: { retryHref: string }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6" data-testid="product-page-error">
      <h1 className="sr-only">Product</h1>
      <Card>
        <ErrorState
          title="We couldn’t load this product."
          description="Everything else is fine. Try again in a moment."
          headingLevel={2}
          action={
            <a href={retryHref} className="inline-flex min-h-ods-control items-center rounded-ods-control border border-ods-line-strong bg-ods-surface px-4 font-semibold text-ods-navy no-underline hover:border-ods-navy">
              Try again
            </a>
          }
        />
      </Card>
    </div>
  );
}
