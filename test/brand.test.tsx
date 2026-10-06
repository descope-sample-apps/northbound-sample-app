import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, ButtonLink } from '@/components/brand/Button';
import { Price } from '@/components/brand/Price';
import { ProductCard } from '@/components/brand/ProductCard';
import type { Product } from '@/db/schema';

const product: Product = {
  id: 1,
  sku: 'NB-PK-001',
  slug: 'cascade-45l-expedition-pack',
  name: 'Cascade 45L Expedition Pack',
  description: 'A 45-litre haul bag.',
  categoryId: 3,
  priceCents: 42_000,
  imagePath: '/products/cascade-45l-expedition-pack.webp',
  stockQty: 20,
  isActive: true,
  createdAt: new Date(),
};

describe('Button', () => {
  it('renders three visually distinct roles', () => {
    const primary = renderToStaticMarkup(<Button variant="primary">Add to cart</Button>);
    const secondary = renderToStaticMarkup(<Button variant="secondary">View all</Button>);
    const ghost = renderToStaticMarkup(<Button variant="ghost">Deny</Button>);

    expect(primary).toContain('bg-spruce');
    expect(secondary).toContain('text-ember');
    expect(ghost).toContain('border-spruce');
    expect(new Set([primary, secondary, ghost]).size).toBe(3);
  });

  it('defaults to the primary role', () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('bg-spruce');
  });

  it('renders a link variant that carries the same treatments', () => {
    const html = renderToStaticMarkup(<ButtonLink href="/shop" variant="secondary">Shop</ButtonLink>);
    expect(html).toContain('href="/shop"');
    expect(html).toContain('text-ember');
  });

  it('passes through the disabled attribute', () => {
    expect(renderToStaticMarkup(<Button disabled>Out of stock</Button>))
      .toContain('disabled');
  });
});

describe('Price', () => {
  it('formats cents as dollars with tabular numerals', () => {
    const html = renderToStaticMarkup(<Price cents={42_000} />);
    expect(html).toContain('$420.00');
    expect(html).toContain('tabular-nums');
  });

  it('renders free as $0.00 rather than blank', () => {
    expect(renderToStaticMarkup(<Price cents={0} />)).toContain('$0.00');
  });
});

describe('ProductCard', () => {
  it('links to the product and shows name, category label and price', () => {
    const html = renderToStaticMarkup(
      <ProductCard product={product} categoryName="Packs &amp; Bags" />,
    );
    expect(html).toContain('href="/product/cascade-45l-expedition-pack"');
    expect(html).toContain('Cascade 45L Expedition Pack');
    expect(html).toContain('$420.00');
  });

  it('marks an out-of-stock product instead of silently looking available', () => {
    const html = renderToStaticMarkup(
      <ProductCard product={{ ...product, stockQty: 0 }} categoryName="Packs" />,
    );
    expect(html).toMatch(/out of stock/i);
  });
});
