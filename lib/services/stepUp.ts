import { createHash } from 'node:crypto';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { backchannelRequests, orders } from '@/db/schema';
import type { ServiceTx } from './tx';
import { formatCents } from '@/lib/money';
import type { ActorContext } from '@/lib/oauth/types';
import { StepUpRequiredError } from './errors';
import { record } from './audit';

/** Orders at or above this need a second approval naming that order. */
export const STEP_UP_THRESHOLD_CENTS = 10_000;

export type StepUpSubject = {
  totalCents: number;
  addressId: number;
  /** productId:quantity pairs, so the basket is part of what was approved. */
  lines: Array<{ productId: number; quantity: number }>;
};

/**
 * Identifies one specific order, before that order exists.
 *
 * The step-up cannot reference an order id — the whole point is that the order
 * cannot be placed until the customer approves. So it references everything
 * that makes this order *this* order: who, which agent, how much, where to, and
 * what is in it.
 *
 * That is what makes "approving order A does not authorise order B" true rather
 * than merely intended. Change the total, the destination or the basket, and
 * the fingerprint no longer matches an approval.
 */
export function fingerprint(ctx: ActorContext, subject: StepUpSubject): string {
  const canonical = JSON.stringify({
    customerId: ctx.customerId,
    agentId: ctx.actor?.agentId ?? null,
    totalCents: subject.totalCents,
    addressId: subject.addressId,
    lines: [...subject.lines]
      .sort((a, b) => a.productId - b.productId)
      .map((line) => [line.productId, line.quantity]),
  });

  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * True when this customer has had an order delivered to this address before.
 *
 * Takes the transaction handle, not the global client. placeOrder calls this
 * from inside its transaction, and opening a second connection there would
 * contend with the write lock it already holds.
 */
async function addressUsedBefore(
  tx: ServiceTx, customerId: number, addressId: number,
): Promise<boolean> {
  const [previous] = await tx.select({ id: orders.id }).from(orders)
    .where(and(
      eq(orders.customerId, customerId),
      eq(orders.shippingAddressId, addressId),
    ))
    .limit(1);

  return Boolean(previous);
}

/**
 * Decides whether this order needs a second approval, and consumes one if the
 * customer has already given it.
 *
 * Two triggers, both from the blog: the order is at or above the threshold, or
 * it ships somewhere this customer has never shipped before. The second matters
 * because redirecting a delivery is how an otherwise-small order becomes theft.
 *
 * Does nothing for a customer acting on their own behalf. They are the person
 * a step-up would ask, so asking them would be theatre.
 */
export async function requireStepUpIfNeeded(
  tx: ServiceTx,
  ctx: ActorContext,
  subject: StepUpSubject,
): Promise<void> {
  if (ctx.actor === null) return;

  const overThreshold = subject.totalCents >= STEP_UP_THRESHOLD_CENTS;
  const newDestination =
    !(await addressUsedBefore(tx, ctx.customerId, subject.addressId));

  if (!overThreshold && !newDestination) return;

  const print = fingerprint(ctx, subject);

  // An approval is single-use: consumed in the same update that finds it, so a
  // second identical order needs its own approval rather than reusing this one.
  const consumed = await tx.update(backchannelRequests)
    .set({ status: 'consumed' })
    .where(and(
      eq(backchannelRequests.stepUpFingerprint, print),
      eq(backchannelRequests.status, 'approved'),
      eq(backchannelRequests.customerId, ctx.customerId),
      gte(backchannelRequests.expiresAt, new Date()),
    ))
    .returning({ id: backchannelRequests.id });

  if (consumed.length > 0) {
    await record(ctx, {
      action: 'step_up_approved',
      summary: 'Approved this specific order.',
      amountCents: subject.totalCents,
    }, tx as never);
    return;
  }

  throw new StepUpRequiredError(
    overThreshold
      ? `This order is ${formatCents(subject.totalCents)}, which needs the `
        + `account holder to approve it specifically.`
      : `This order ships to an address that has not been used before, which `
        + `needs the account holder to approve it specifically.`,
    print,
    subject.totalCents,
    overThreshold ? 'amount' : 'new_address',
  );
}

/** A pending step-up already waiting on this exact order, if there is one. */
export async function findPendingStepUp(print: string): Promise<string | null> {
  const [pending] = await db.select({ id: backchannelRequests.id })
    .from(backchannelRequests)
    .where(and(
      eq(backchannelRequests.stepUpFingerprint, print),
      eq(backchannelRequests.status, 'pending'),
      isNotNull(backchannelRequests.customerId),
      gte(backchannelRequests.expiresAt, new Date()),
    ))
    .limit(1);

  return pending?.id ?? null;
}
