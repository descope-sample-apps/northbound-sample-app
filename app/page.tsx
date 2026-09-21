import Link from 'next/link';
import { ButtonLink } from '@/components/brand/Button';
import { ProductCard } from '@/components/brand/ProductCard';
import { listCategories, searchProducts } from '@/lib/services/catalog';

export default async function Home() {
  const [categories, featured] = await Promise.all([
    listCategories(),
    searchProducts({ perPage: 3, sort: 'price-desc' }),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <main>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20 sm:pt-24">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ember">
          New for autumn
        </p>
        <h1 className="display mt-3 max-w-[18ch] text-[clamp(2.25rem,6vw,3.25rem)] leading-[1.1]">
          Gear that earns its place on your back.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink/75">
          Built to be repaired rather than replaced. Everything we make is sold
          with the parts and the instructions to keep it going.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-7">
          <ButtonLink href="/shop">Shop all gear</ButtonLink>
          <ButtonLink href="/shop/outerwear" variant="secondary">
            New outerwear
          </ButtonLink>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-4">
        <div className="flex items-baseline justify-between border-b border-rule pb-3">
          <h2 className="display text-2xl">The heavy hitters</h2>
          <Link
            href="/shop?sort=price-desc"
            className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted hover:text-spruce"
          >
            See all
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3">
          {featured.items.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              categoryName={categoryName.get(product.categoryId)}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="display border-b border-rule pb-3 text-2xl">Shop by category</h2>
        <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/shop/${category.slug}`}
              className="group block border-t border-rule pt-4"
            >
              <div className="display text-lg group-hover:text-spruce">{category.name}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {category.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
