import { and, asc, desc, eq, gte, like, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { categories, products, type Category, type Product } from '@/db/schema';
import { NotFoundError, ValidationError } from './errors';

export async function listCategories(): Promise<Category[]> {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export async function getProductBySlug(slug: string): Promise<Product> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1);

  if (!product) throw new NotFoundError('Product');
  return product;
}

// Validation lives here rather than in the server action, so that every future
// caller of this service — the agent API, the MCP server — is validated by the
// same rules instead of by whatever the calling surface remembered to check.
const FiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  categorySlug: z.string().max(100).optional(),
  minCents: z.number().int().nonnegative().optional(),
  maxCents: z.number().int().nonnegative().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc', 'name']).default('featured'),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(24),
});

export type ProductFilters = z.input<typeof FiltersSchema>;

/** Escapes LIKE metacharacters so a search for "%" matches a literal percent. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchProducts(
  raw: ProductFilters,
): Promise<{ items: Product[]; total: number }> {
  const parsed = FiltersSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const filters = parsed.data;

  const clauses: SQL[] = [eq(products.isActive, true)];

  if (filters.q) {
    const needle = `%${escapeLike(filters.q.toLowerCase())}%`;
    clauses.push(like(sql`lower(${products.name})`, sql`${needle} escape '\\'`));
  }
  if (filters.minCents !== undefined) clauses.push(gte(products.priceCents, filters.minCents));
  if (filters.maxCents !== undefined) clauses.push(lte(products.priceCents, filters.maxCents));

  if (filters.categorySlug) {
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, filters.categorySlug))
      .limit(1);

    // An unknown category is an empty shelf, not an error — a stale link should
    // render a page, not a stack trace.
    if (!category) return { items: [], total: 0 };
    clauses.push(eq(products.categoryId, category.id));
  }

  const where = and(...clauses);

  const order =
    filters.sort === 'price-asc' ? asc(products.priceCents)
    : filters.sort === 'price-desc' ? desc(products.priceCents)
    : filters.sort === 'name' ? asc(products.name)
    : asc(products.id);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(where);

  const items = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(order)
    .limit(filters.perPage)
    .offset((filters.page - 1) * filters.perPage);

  return { items, total: Number(count) };
}
