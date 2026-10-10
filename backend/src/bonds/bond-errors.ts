/** The stored data needed to value a lot is not there. */
export class BondDataNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BondDataNotFoundError";
  }
}

/** Stored rows contradict each other; refuse rather than value them. */
export class BondDataInconsistentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BondDataInconsistentError";
  }
}
