/**
 * Services throw these. They never return HTTP concepts.
 *
 * The storefront maps them to form errors. Sub-project B will map the same
 * classes to status codes on the agent API, and sub-project E to MCP tool
 * errors. Keeping transport out of the service layer is what lets all three
 * surfaces share one implementation instead of drifting apart.
 */
export abstract class ServiceError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends ServiceError {
  readonly code = 'not_found';
  constructor(what: string) {
    super(`${what} not found`);
  }
}

/**
 * Raised when a customer references a row belonging to someone else.
 *
 * Note that reads deliberately prefer NotFoundError over this: telling an
 * unauthorized caller "forbidden" confirms the record exists. OwnershipError is
 * for writes where the caller supplied an id they are expected to own.
 */
export class OwnershipError extends ServiceError {
  readonly code = 'forbidden';
  constructor(what: string) {
    super(`${what} does not belong to this customer`);
  }
}

export class OutOfStockError extends ServiceError {
  readonly code = 'out_of_stock';
  constructor(
    public readonly productName: string,
    public readonly available: number,
  ) {
    super(
      available === 0
        ? `${productName} is out of stock`
        : `${productName} has only ${available} left`,
    );
  }
}

export class ValidationError extends ServiceError {
  readonly code = 'invalid';
}

/** The basket total moved between the price shown and the charge attempted. */
export class PriceChangedError extends ServiceError {
  readonly code = 'price_changed';
  constructor(
    public readonly expectedCents: number,
    public readonly actualCents: number,
  ) {
    super(`Price changed: expected ${expectedCents}, now ${actualCents}`);
  }
}

/**
 * The database could not be written to because something else was writing.
 *
 * SQLite allows a single writer at a time, and @libsql/client opens a separate
 * connection per transaction, so two checkouts a second apart contend for the
 * write lock even when they touch no row in common. Without this, the loser
 * receives a raw LibsqlError — which is not a ServiceError, escapes the service
 * layer's contract, and reaches the customer as an unhandled crash.
 */
export class ConcurrencyError extends ServiceError {
  readonly code = 'busy';
  constructor() {
    super('Someone else was checking out at the same moment. Please try again.');
  }
}
