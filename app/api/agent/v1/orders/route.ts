import { withAgent, readJson, badRequest, jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { orderDetailShape, orderSummaryShape } from '@/lib/api/shapes';
import { getOrder, listOrders, placeOrder } from '@/lib/services/orders';
import { listAddresses } from '@/lib/services/addresses';
import { listPaymentMethods } from '@/lib/services/paymentMethods';

export const dynamic = 'force-dynamic';

/**
 * The customer's orders, newest first.
 *
 * This is the endpoint behind "where is my parka": an assistant reads the list, finds the
 * order carrying that item, and reports its status. Item names live on the detail
 * endpoint, so the list stays one row per order rather than the customer's whole history
 * of purchases in a single response.
 *
 * `mine=true` narrows the list to orders this assistant placed itself. listOrders never
 * drops the customer filter when it does, so the parameter cannot be used to read across
 * customers — it only ever narrows one customer's own orders.
 */
export const GET = withAgent('read', async (request, session) => {
  const url = new URL(request.url);
  const mine = url.searchParams.get('mine') === 'true';

  const limitParam = url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitParam !== null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return badRequest('limit must be a whole number between 1 and 50.');
    }
  }

  const orders = await listOrders(session.customer.id, {
    limit,
    ...(mine ? { placedByAgent: session.agent } : {}),
  });

  const origin = publicOrigin(request);
  return jsonResponse({
    // Echoed so that a trace, or the assistant itself, can see this response was produced
    // FOR a customer BY an agent, and that the two are not the same party.
    acting_for: session.email,
    actor: session.agent,
    orders: orders.map((order) => orderSummaryShape(order, origin)),
  });
});

/**
 * Places the customer's current cart as an order.
 *
 * THE CART IS THE ORDER. There is no items parameter: an assistant builds the cart with
 * POST /cart/items, reads back the total it is about to spend, and then commits to it.
 * Taking items here instead would mean either silently checking out whatever else the
 * customer already had in their cart, or quietly discarding it — and a purchase is not
 * somewhere to guess.
 *
 * expected_total_cents is the guardrail and SHOULD always be sent. placeOrder refuses to
 * charge anything else, so a price that moved between the cart the assistant read and the
 * charge it is making comes back as 409 rather than as a surprise on the customer's card.
 *
 * No step-up here, unlike the storefront's checkout. lib/agentSession/stepUp.ts answers a
 * browser by redirecting it to the front door to collect the customer's approval, which is
 * not something an API client can follow. On this surface the scope IS the approval: a
 * token without orders:write was refused before this handler ran.
 */
export const POST = withAgent('write', async (request, session) => {
  const body = await readJson(request);
  if (!body) return badRequest('The request body must be a JSON object.');

  const customerId = session.customer.id;

  // Omitted ids mean the customer's defaults. That is not a shortcut this endpoint
  // invented: orders:write is published as "Place an order with your saved address and
  // card", so the saved ones are exactly what the customer approved it to use.
  let addressId = body.address_id;
  if (addressId === undefined) {
    const addresses = await listAddresses(customerId);
    const chosen = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (!chosen) return badRequest('This customer has no saved address. Ask them to add one.');
    addressId = chosen.id;
  }

  let paymentMethodId = body.payment_method_id;
  if (paymentMethodId === undefined) {
    const methods = await listPaymentMethods(customerId);
    const chosen = methods.find((m) => m.isDefault) ?? methods[0];
    if (!chosen) {
      return badRequest('This customer has no saved payment method. Ask them to add one.');
    }
    paymentMethodId = chosen.id;
  }

  if (typeof addressId !== 'number' || typeof paymentMethodId !== 'number') {
    return badRequest('address_id and payment_method_id must be numbers.');
  }

  const expected = body.expected_total_cents;
  if (expected !== undefined && typeof expected !== 'number') {
    return badRequest('expected_total_cents must be a number.');
  }

  const order = await placeOrder(customerId, {
    addressId,
    paymentMethodId,
    ...(expected === undefined ? {} : { expectedTotalCents: expected }),
    // Recorded on the order itself, so the customer and support can always tell which
    // assistant placed it and the customer can see it in their own order history.
    placedByAgent: session.agent,
  });

  // Read the order back rather than reshaping the row placeOrder returns. The row has no
  // items on it, and an assistant that has just spent the customer's money should be able
  // to tell them what it bought, what it cost and where it is going without asking again.
  const placed = await getOrder(customerId, order.orderNumber);

  return jsonResponse(
    {
      acting_for: session.email,
      actor: session.agent,
      order: orderDetailShape(placed, publicOrigin(request)),
    },
    201,
  );
});
