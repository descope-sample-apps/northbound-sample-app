import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartForm } from '@/components/brand/AddToCartForm';
import { ButtonLink } from '@/components/brand/Button';
import { Price } from '@/components/brand/Price';
import { getProductBySlug, listCategories } from '@/lib/services/catalog';
import { NotFoundError } from '@/lib/services/errors';

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let product;
  try {
    product = await getProductBySlug(slug);
  } catch (error) {
    // Services throw domain errors; the page decides what that means for HTTP.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const category = (await listCategories()).find((c) => c.id === product.categoryId);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <nav className="mb-8 text-[10px] uppercase tracking-[0.13em] text-muted">
        <Link href="/shop" className="hover:text-spruce">Shop</Link>
        {category && (
          <>
            <span className="mx-2">/</span>
            <Link href={`/shop/${category.slug}`} className="hover:text-spruce">
              {category.name}
            </Link>
          </>
        )}
      </nav>

      <div className="grid gap-12 md:grid-cols-2">
        <Image
          src={product.imagePath}
          alt={product.name}
          width={800}
          height={600}
          priority
          className="aspect-[4/3] w-full rounded-lg object-cover"
        />

        <div>
          {category && (
            <div className="text-[10px] uppercase tracking-[0.13em] text-muted">
              {category.name}
            </div>
          )}
          <h1 className="display mt-2 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight">
            {product.name}
          </h1>
          <Price cents={product.priceCents} className="mt-3 block text-2xl" />

          <p className="mt-6 max-w-[48ch] leading-relaxed text-ink/80">
            {product.description}
          </p>

          <AddToCartForm
            productId={product.id}
            slug={product.slug}
            stockQty={product.stockQty}
          />

          <div className="mt-10 border-t border-rule pt-5">
            <ButtonLink
              href={category ? `/shop/${category.slug}` : '/shop'}
              variant="secondary"
            >
              {category ? `All ${category.name}` : 'Back to shop'}
            </ButtonLink>
          </div>

          <dl className="mt-8 space-y-2 text-sm text-muted">
            <div className="flex gap-3">
              <dt className="w-20 uppercase tracking-[0.1em] text-[10px] pt-0.5">SKU</dt>
              <dd className="tabular-nums">{product.sku}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-20 uppercase tracking-[0.1em] text-[10px] pt-0.5">Shipping</dt>
              <dd>Free over $75. Otherwise $8.95.</dd>
            </div>
          </dl>
        </div>
      </div>
    </main>
  );
}
