import Link from 'next/link';
import { ProductCard } from './ProductCard';
import { listCategories, searchProducts, type ProductFilters } from '@/lib/services/catalog';

const SORTS = [
  ['featured', 'Featured'],
  ['price-asc', 'Price, low to high'],
  ['price-desc', 'Price, high to low'],
  ['name', 'Name'],
] as const;

/**
 * The listing surface shared by /shop and /shop/[category].
 *
 * Filters are plain links and a GET form rather than client state, so every
 * view of the catalog is a URL someone can share or bookmark.
 */
export async function ProductGrid({
  filters,
  activeCategorySlug,
  basePath,
}: {
  filters: ProductFilters;
  activeCategorySlug?: string;
  basePath: string;
}) {
  const [categories, result] = await Promise.all([
    listCategories(),
    searchProducts(filters),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[210px_1fr]">
      <aside className="space-y-8">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Categories
          </div>
          <ul className="mt-3 space-y-2">
            <li>
              <Link
                href="/shop"
                className={`text-sm hover:text-spruce ${!activeCategorySlug ? 'font-semibold text-spruce' : ''}`}
              >
                All gear
              </Link>
            </li>
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/shop/${category.slug}`}
                  className={`text-sm hover:text-spruce ${
                    activeCategorySlug === category.slug ? 'font-semibold text-spruce' : ''
                  }`}
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <form action={basePath} className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            Price
          </div>
          <div className="flex gap-2">
            <input
              name="min" type="number" min="0" placeholder="Min $"
              defaultValue={filters.minCents ? filters.minCents / 100 : ''}
              className="w-full rounded-[3px] border border-rule bg-surface px-2 py-1.5 text-sm outline-none focus:border-spruce"
            />
            <input
              name="max" type="number" min="0" placeholder="Max $"
              defaultValue={filters.maxCents ? filters.maxCents / 100 : ''}
              className="w-full rounded-[3px] border border-rule bg-surface px-2 py-1.5 text-sm outline-none focus:border-spruce"
            />
          </div>
          <input
            name="q" placeholder="Search" defaultValue={filters.q ?? ''}
            className="w-full rounded-[3px] border border-rule bg-surface px-2 py-1.5 text-sm outline-none focus:border-spruce"
          />
          <button
            type="submit"
            className="w-full rounded-[3px] bg-spruce px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-paper hover:bg-spruce-deep"
          >
            Apply
          </button>
        </form>
      </aside>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
          <p className="text-sm text-muted">
            {result.total} {result.total === 1 ? 'product' : 'products'}
          </p>
          <div className="flex flex-wrap gap-4">
            {SORTS.map(([value, label]) => (
              <Link
                key={value}
                href={`${basePath}?sort=${value}`}
                className={`text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-spruce ${
                  filters.sort === value ? 'text-spruce' : 'text-muted'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {result.items.length === 0 ? (
          <p className="py-16 text-center text-muted">
            Nothing here matches those filters.
          </p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3">
            {result.items.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                categoryName={categoryName.get(product.categoryId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Turns raw searchParams into validated service filters. */
export function filtersFromSearchParams(
  params: Record<string, string | string[] | undefined>,
): ProductFilters {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const dollarsToCents = (value: string | undefined) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
  };

  const sort = one('sort');
  const page = Number(one('page'));

  return {
    q: one('q') || undefined,
    minCents: dollarsToCents(one('min')),
    maxCents: dollarsToCents(one('max')),
    sort: SORTS.some(([value]) => value === sort)
      ? (sort as ProductFilters['sort'])
      : 'featured',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    perPage: 24,
  };
}
