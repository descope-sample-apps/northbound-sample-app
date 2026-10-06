import { ProductGrid, filtersFromSearchParams } from '@/components/brand/ProductGrid';

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = filtersFromSearchParams(await searchParams);

  return (
    <main>
      <div className="mx-auto max-w-6xl px-6 pt-14">
        <h1 className="display text-4xl">All gear</h1>
        <p className="mt-2 max-w-[54ch] text-ink/70">
          Sixty-four things we make, and nothing we do not.
        </p>
      </div>
      <ProductGrid filters={filters} basePath="/shop" />
    </main>
  );
}
