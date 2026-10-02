import type { db } from '@/db/client';

/**
 * The subset of the database handle a guard needs.
 *
 * Guards that run inside placeOrder's transaction must use ITS handle. Reaching
 * for the global client instead opens a second connection, which contends with
 * the write lock the transaction already holds and surfaces as a lock timeout
 * rather than as the decision the guard was asked to make.
 */
export type ServiceTx = Pick<typeof db, 'select' | 'update'>;
