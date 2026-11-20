import { withAgent, readJson, badRequest, jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { cartShape } from '@/lib/api/shapes';
import { addToCart, getCart, updateCartItem } from '@/lib/services/cart';
import { getProductBySlug } from '@/lib/services/catalog';

export const dynamic = 'force-dynamic';

/**
 * Sets how many of one product the cart holds, and answers with the whole cart.
 *
 * SET, NOT ADD, so a retry is harmless. An agent that times out and sends the same request
 * again has told the store the same fact twice — two of this product — rather than putting
 * four in the cart. quantity 0 removes the line.
 *
 * orders:write rather than orders:read, even though nothing is bought yet. orders:read is
 * published as `changes: "none"`, and a cart an assistant can rewrite is a change: the
 * customer finds different things in it than they left there.
 *
 * Returning the cart rather than 204 is what makes the next step safe — the agent reads
 * the new total here and hands it straight to POST /orders as expected_total_cents.
 */
export const POST = withAgent('write', async (request, session) => {
  const body = await readJson(request);
  if (!body) return badRequest('The request body must be a JSON object.');

  const { slug, quantity } = body;
  if (typeof slug !== 'string' || !slug) return badRequest('slug must be a product slug.');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0) {
    return badRequest('quantity must be a whole number of 0 or more.');
  }

  // Throws NotFoundError for an unknown slug, which the wrapper turns into a 404.
  const product = await getProductBySlug(slug);
  const owner = { customerId: session.customer.id };

  // addToCart inserts a line and adds to an existing one; updateCartItem only ever
  // rewrites a line that is already there. Which one gives "set" depends on whether the
  // product is in the cart, so that is what decides — not the caller.
  const before = await getCart(owner);
  const existing = before.items.find((line) => line.slug === slug);

  if (existing) {
    await updateCartItem(owner, product.id, quantity);
  } else if (quantity > 0) {
    await addToCart(owner, product.id, quantity);
  }
  // quantity 0 on a product that is not in the cart is already true. Nothing to do.

  return jsonResponse({
    acting_for: session.email,
    actor: session.agent,
    cart: cartShape(await getCart(owner), publicOrigin(request)),
  });
});
