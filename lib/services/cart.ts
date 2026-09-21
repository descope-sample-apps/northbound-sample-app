import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { carts, cartItems, products } from '@/db/schema';
import { calcTotals } from '@/lib/money';
import { NotFoundError, OutOfStockError, ValidationError } from './errors';

export type CartLine = {
  productId: number;
  slug: string;
  name: string;
  imagePath: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  /** Surfaced so checkout can warn before it fails. */
  stockQty: number;
  isActive: boolean;
};

export type CartView = {
  items: CartLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

const MAX_QTY_PER_LINE = 99;

// `.int()` rejects NaN, Infinity, and fractions in one rule.
const QuantitySchema = z
  .number()
  .int('Quantity must be a whole number')
  .positive('Quantity must be at least 1')
  .max(MAX_QTY_PER_LINE, `Quantity may not exceed ${MAX_QTY_PER_LINE}`);

function parseQuantity(quantity: number): number {
  const parsed = QuantitySchema.safeParse(quantity);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  return parsed.data;
}

// Every function below takes customerId first and scopes its writes through
// this lookup. That is what makes it impossible for one customer to touch
// another's cart, and it is the same shape the agent API will inherit.
async function getOrCreateCart(customerId: number) {
  const [existing] = await db
    .select()
    .from(carts)
    .where(eq(carts.customerId, customerId))
    .limit(1);

  if (existing) return existing;

  // Upsert rather than read-then-insert. `carts.customer_id` is UNIQUE, and a
  // customer's first authenticated page load makes two simultaneous calls here:
  // the root layout's Nav reads the cart at the same time as the page body. A
  // plain insert loses that race with a constraint violation on an empty cart.
  const now = new Date();
  await db
    .insert(carts)
    .values({ customerId, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: carts.customerId });

  const [cart] = await db
    .select()
    .from(carts)
    .where(eq(carts.customerId, customerId))
    .limit(1);

  return cart;
}

async function touch(cartId: number) {
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function getCart(customerId: number): Promise<CartView> {
  const cart = await getOrCreateCart(customerId);

  const rows = await db
    .select({ item: cartItems, product: products })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(cartItems.id);

  // Price is read live from the catalog, never stored on the line. Snapshotting
  // happens exactly once, at order time.
  const items: CartLine[] = rows.map(({ item, product }) => ({
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imagePath: product.imagePath,
    unitPriceCents: product.priceCents,
    quantity: item.quantity,
    lineTotalCents: product.priceCents * item.quantity,
    stockQty: product.stockQty,
    isActive: product.isActive,
  }));

  const subtotal = items.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return { items, ...calcTotals(subtotal) };
}

export async function addToCart(
  customerId: number,
  productId: number,
  quantity: number,
): Promise<void> {
  const qty = parseQuantity(quantity);

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.isActive, true)))
    .limit(1);

  if (!product) throw new NotFoundError('Product');

  const cart = await getOrCreateCart(customerId);

  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)))
    .limit(1);

  // What is already in the cart counts against stock, or adding one at a time
  // would walk past the limit.
  const desired = (existing?.quantity ?? 0) + qty;

  if (desired > product.stockQty) {
    throw new OutOfStockError(product.name, product.stockQty);
  }
  if (desired > MAX_QTY_PER_LINE) {
    throw new ValidationError(`Quantity may not exceed ${MAX_QTY_PER_LINE}`);
  }

  if (existing) {
    await db.update(cartItems).set({ quantity: desired }).where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({ cartId: cart.id, productId, quantity: desired });
  }

  await touch(cart.id);
}

export async function updateCartItem(
  customerId: number,
  productId: number,
  quantity: number,
): Promise<void> {
  if (quantity === 0) return removeFromCart(customerId, productId);

  const qty = parseQuantity(quantity);

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) throw new NotFoundError('Product');
  if (qty > product.stockQty) throw new OutOfStockError(product.name, product.stockQty);

  const cart = await getOrCreateCart(customerId);

  await db
    .update(cartItems)
    .set({ quantity: qty })
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));

  await touch(cart.id);
}

export async function removeFromCart(customerId: number, productId: number): Promise<void> {
  const cart = await getOrCreateCart(customerId);

  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));

  await touch(cart.id);
}

export async function clearCart(customerId: number): Promise<void> {
  const cart = await getOrCreateCart(customerId);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await touch(cart.id);
}
