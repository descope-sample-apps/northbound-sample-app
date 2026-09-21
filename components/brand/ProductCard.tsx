import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/db/schema';
import { Price } from './Price';

export function ProductCard({
  product,
  categoryName,
}: {
  product: Product;
  categoryName?: string;
}) {
  const outOfStock = product.stockQty <= 0;

  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="relative overflow-hidden rounded-[7px] bg-surface">
        <Image
          src={product.imagePath}
          alt={product.name}
          width={800}
          height={600}
          className="aspect-[4/3] w-full object-cover"
        />
        {outOfStock && (
          <span className="absolute left-3 top-3 bg-ink/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-paper">
            Out of stock
          </span>
        )}
      </div>

      <div className="pt-3">
        {categoryName && (
          <div className="text-[10px] uppercase tracking-[0.13em] text-muted">
            {categoryName}
          </div>
        )}
        <h3 className="display mt-1 text-[15px] leading-snug group-hover:text-spruce">
          {product.name}
        </h3>
        <Price cents={product.priceCents} className="mt-1 block text-sm font-medium" />
      </div>
    </Link>
  );
}
