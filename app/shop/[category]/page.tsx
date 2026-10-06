import { notFound } from 'next/navigation';
import { ProductGrid, filtersFromSearchParams } from '@/components/brand/ProductGrid';
import { listCategories } from '@/lib/services/catalog';

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { category: slug } = await params;

  // A real category with nothing in it is a valid page; a slug that does not
  // exist is a 404. Checking the category list rather than the result count is
  // what tells those two apart.
  const category = (await listCategories()).find((c) => c.slug === slug);
  if (!category) notFound();

  const filters = { ...filtersFromSearchParams(await searchParams), categorySlug: slug };

  return (
    <main>
      <div className="mx-auto max-w-6xl px-6 pt-14">
        <h1 className="display text-4xl">{category.name}</h1>
        <p className="mt-2 max-w-[54ch] text-ink/70">{category.description}</p>
      </div>
      <ProductGrid
        filters={filters}
        activeCategorySlug={slug}
        basePath={`/shop/${slug}`}
      />
    </main>
  );
}
