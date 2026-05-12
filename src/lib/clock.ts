/** Injectable clock so time-dependent code (token expiry, idempotency TTL) is deterministic in tests. */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
