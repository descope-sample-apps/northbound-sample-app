import { ConcurrencyError, ServiceError } from './errors';

/**
 * Serializes write transactions within this process.
 *
 * WHY A QUEUE AND NOT A RETRY
 *
 * SQLite permits one writer at a time, and @libsql/client opens a separate
 * connection to begin a transaction. Two checkouts a second apart therefore
 * contend for the write lock even when they touch no row in common, and the
 * loser gets `SQLITE_BUSY: database is locked`.
 *
 * Retrying does not work. Once a transaction has failed that way, the next
 * attempt on the same client fails differently and worse:
 *
 *     SQLITE_BUSY: cannot commit transaction - SQL statements in progress
 *
 * The failed transaction leaves the connection in a state a retry cannot
 * recover from, so the only reliable answer is to not contend in the first
 * place. Writes queue here and run one at a time.
 *
 * LIMITS, STATED PLAINLY
 *
 * This serializes one Node process. Two `pnpm dev` servers against the same
 * file would still contend — which is why the BUSY translation below is kept
 * as a backstop, so even then the customer gets a typed error and a retry
 * prompt rather than an unhandled crash. Pointed at hosted libsql (Turso), the
 * server does the serializing and this queue is just a local ordering.
 *
 * It is a demo-scale answer, and it is the honest one: a real retailer would
 * put a database with MVCC behind this and delete the file.
 */
let tail: Promise<unknown> = Promise.resolve();

function isLockContention(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    messages.push(current.message);
    current = (current as Error & { cause?: unknown }).cause;
  }

  return messages.some((message) =>
    /SQLITE_BUSY|database is locked|database table is locked/i.test(message),
  );
}

export function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
  // Chain onto the previous write whether it resolved or rejected, so one
  // failure does not wedge the queue for everything behind it.
  const run = tail.then(
    () => work(),
    () => work(),
  ).catch((error: unknown) => {
    if (error instanceof ServiceError) throw error;

    // A ServiceError is a decision — out of stock, price changed — and must
    // reach the caller unchanged. Anything that is lock contention becomes a
    // typed error so it cannot escape the service layer's contract.
    if (isLockContention(error)) {
      console.warn('write lock contention escaped the queue', error);
      throw new ConcurrencyError();
    }

    throw error;
  });

  tail = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}
