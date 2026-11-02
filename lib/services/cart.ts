import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { carts, cartItems, products } from '@/db/schema';
import { calcTotals } from '@/lib/money';
import { NotFoundError, OutOfStockError, ValidationError } from './errors';
import { withWriteLock } from './writeLock';

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

/**
 * Who a cart belongs to: a signed-in customer, or a browser that has not signed
 * in. Every function below takes one and scopes its writes through the lookup it
 * drives, which is what makes it impossible for one owner to touch another's cart.
 */
export type CartOwner = { customerId: number } | { token: string };

function ownerMatch(owner: CartOwner) {
  return 'customerId' in owner ? eq(carts.customerId, owner.customerId) : eq(carts.token, owner.token);
}

async function getOrCreateCart(owner: CartOwner) {
  const match = ownerMatch(owner);
  const [existing] = await db.select().from(carts).where(match).limit(1);

  if (existing) return existing;

  // Upsert rather than read-then-insert. Both owner columns are UNIQUE, and a
  // first page load makes two simultaneous calls here: the root layout's Nav
  // reads the cart at the same time as the page body. A plain insert loses that
  // race with a constraint violation on an empty cart.
  const now = new Date();
  await db
    .insert(carts)
    .values({ ...owner, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: 'customerId' in owner ? carts.customerId : carts.token });

  const [cart] = await db.select().from(carts).where(match).limit(1);

  return cart;
}

const EMPTY_CART: CartView = { items: [], ...calcTotals(0) };

async function touch(cartId: number) {
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

/**
 * A null owner is a visitor who has neither signed in nor put anything in a cart
 * yet. They get the empty view and no row is written, so browsing costs nothing.
 */
export async function getCart(owner: CartOwner | null): Promise<CartView> {
  if (!owner) return EMPTY_CART;

  const cart = await getOrCreateCart(owner);

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
  owner: CartOwner,
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

  const cart = await getOrCreateCart(owner);

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
  owner: CartOwner,
  productId: number,
  quantity: number,
): Promise<void> {
  if (quantity === 0) return removeFromCart(owner, productId);

  const qty = parseQuantity(quantity);

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) throw new NotFoundError('Product');
  if (qty > product.stockQty) throw new OutOfStockError(product.name, product.stockQty);

  const cart = await getOrCreateCart(owner);

  await db
    .update(cartItems)
    .set({ quantity: qty })
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));

  await touch(cart.id);
}

export async function removeFromCart(owner: CartOwner, productId: number): Promise<void> {
  const cart = await getOrCreateCart(owner);

  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));

  await touch(cart.id);
}

/**
 * Moves a guest cart onto a customer at sign-in, then deletes it.
 *
 * Best effort on purpose. This runs inside sign-in, and a line that went out of
 * stock while the cart sat in a browser must not stop someone signing in: it is
 * capped at what is left, or dropped when nothing is. The alternative — refusing
 * the sign-in, or throwing away the whole cart over one line — is worse in both
 * directions.
 *
 * Quantities add rather than replace, so a product in both carts ends up with
 * the sum, bounded by stock and by the per-line maximum.
 */
export async function adoptGuestCart(token: string, customerId: number): Promise<void> {
  return withWriteLock(async () => {
    const [guest] = await db.select().from(carts).where(eq(carts.token, token)).limit(1);
    if (!guest) return;

    const lines = await db
      .select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.cartId, guest.id))
      .orderBy(cartItems.id);

    if (lines.length > 0) {
      const mine = await getOrCreateCart({ customerId });

      for (const { item, product } of lines) {
        if (!product.isActive) continue;

        const [existing] = await db
          .select()
          .from(cartItems)
          .where(and(eq(cartItems.cartId, mine.id), eq(cartItems.productId, product.id)))
          .limit(1);

        const desired = Math.min(
          (existing?.quantity ?? 0) + item.quantity,
          product.stockQty,
          MAX_QTY_PER_LINE,
        );

        if (desired <= 0) continue;

        if (existing) {
          if (desired !== existing.quantity) {
            await db.update(cartItems).set({ quantity: desired }).where(eq(cartItems.id, existing.id));
          }
        } else {
          await db.insert(cartItems).values({ cartId: mine.id, productId: product.id, quantity: desired });
        }
      }

      await touch(mine.id);
    }

    await db.delete(cartItems).where(eq(cartItems.cartId, guest.id));
    await db.delete(carts).where(eq(carts.id, guest.id));
  });
}

export async function clearCart(owner: CartOwner): Promise<void> {
  const cart = await getOrCreateCart(owner);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await touch(cart.id);
}
