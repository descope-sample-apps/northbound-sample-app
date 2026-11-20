import type { Address, PaymentMethod, Product } from '@/db/schema';
import { formatCents } from '@/lib/money';
import type { CartView } from '@/lib/services/cart';
import type { OrderDetail, OrderSummary } from '@/lib/services/orders';

/**
 * What the agent API puts on the wire.
 *
 * Separate from the services so the database's column names are not the API's contract:
 * renaming a column should not break an agent, and the storefront's own types stay free
 * to carry things an agent has no business with.
 *
 * MONEY TWICE, ON PURPOSE. Integer cents are what arithmetic is safe on; the formatted
 * string is what an assistant should repeat to the customer. An agent asked to say what
 * an order cost then has no reason to divide by 100 itself and no way to round it wrong.
 *
 * snake_case, because that is what the rest of the discovery surface already speaks.
 */

export type ProductShape = ReturnType<typeof productShape>;

/**
 * Where a product lives on the website.
 *
 * SAID RATHER THAN LEFT TO BE GUESSED. An assistant that names a product wants to link
 * it, and without this the only hint it has is the API's own path — /products, plural,
 * while the page is app/product/[slug], singular. Assistants have guessed the plural and
 * sent customers to a 404.
 *
 * One function because the catalog and the cart both hand this out, and a store that
 * renamed the route would otherwise have two places to remember.
 */
function productUrl(origin: string, slug: string) {
  return `${origin}/product/${slug}`;
}

export function productShape(product: Product, origin: string) {
  return {
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: formatCents(product.priceCents),
    price_cents: product.priceCents,
    in_stock: product.stockQty > 0,
    stock_quantity: product.stockQty,
    url: productUrl(origin, product.slug),
    // The picture the storefront shows, for an assistant whose interface can draw one. It
    // is `/products/<slug>.webp` — plural, with an extension, and so not the page URL
    // above with a suffix. Another thing worth saying rather than leaving to be worked out.
    image_url: `${origin}${product.imagePath}`,
  };
}

export function cartShape(cart: CartView, origin: string) {
  return {
    items: cart.items.map((line) => ({
      slug: line.slug,
      name: line.name,
      quantity: line.quantity,
      unit_price: formatCents(line.unitPriceCents),
      unit_price_cents: line.unitPriceCents,
      line_total: formatCents(line.lineTotalCents),
      line_total_cents: line.lineTotalCents,
      in_stock: line.isActive && line.stockQty >= line.quantity,
      // The same link the catalog gives, so "show me what is in my cart" can be a list
      // of links rather than a list of names. A line that has gone out of stock is the
      // one a customer most wants to open.
      url: productUrl(origin, line.slug),
      image_url: `${origin}${line.imagePath}`,
    })),
    subtotal_cents: cart.subtotalCents,
    shipping_cents: cart.shippingCents,
    tax_cents: cart.taxCents,
    total: formatCents(cart.totalCents),
    total_cents: cart.totalCents,
  };
}

export function orderSummaryShape(order: OrderSummary, origin: string) {
  return {
    order_number: order.orderNumber,
    status: order.status,
    placed_at: order.placedAt.toISOString(),
    item_count: order.itemCount,
    total: formatCents(order.totalCents),
    total_cents: order.totalCents,
    // Null when the customer placed it themselves. An assistant asked "did you order
    // this?" can answer from the order rather than from memory.
    placed_by_agent: order.placedByAgent,
    // The page the customer would see. An assistant that has found the order can hand
    // its person a link instead of asking them to go looking.
    url: `${origin}/orders/${order.orderNumber}`,
  };
}

export function orderDetailShape(order: OrderDetail, origin: string) {
  return {
    order_number: order.orderNumber,
    status: order.status,
    placed_at: order.placedAt.toISOString(),
    items: order.items.map((item) => ({
      // The name as it was when the order was placed, not today's catalog name —
      // which is the whole reason order_items keeps a snapshot.
      name: item.nameSnapshot,
      quantity: item.quantity,
      unit_price: formatCents(item.unitPriceCents),
      unit_price_cents: item.unitPriceCents,
      line_total: formatCents(item.lineTotalCents),
      line_total_cents: item.lineTotalCents,
    })),
    subtotal_cents: order.subtotalCents,
    shipping_cents: order.shippingCents,
    tax_cents: order.taxCents,
    total: formatCents(order.totalCents),
    total_cents: order.totalCents,
    shipping_address: addressShape(order.address),
    payment_method: paymentMethodShape(order.paymentMethod),
    placed_by_agent: order.placedByAgent,
    url: `${origin}/orders/${order.orderNumber}`,
  };
}

export function addressShape(address: Address) {
  return {
    id: address.id,
    label: address.label,
    recipient: address.recipient,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postal_code: address.postalCode,
    country: address.country,
    is_default: address.isDefault,
  };
}

/**
 * Brand, last four and expiry. There is nothing else to send — payment_methods has no
 * column a full number could be written to (db/schema/account.ts) — and an assistant
 * needs only enough to say which card it would be charging.
 */
export function paymentMethodShape(method: PaymentMethod) {
  return {
    id: method.id,
    brand: method.brand,
    last4: method.last4,
    exp_month: method.expMonth,
    exp_year: method.expYear,
    is_default: method.isDefault,
  };
}
