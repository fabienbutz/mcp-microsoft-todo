import { describe, expect, it } from "vitest";
import { IdempotencyCache } from "../src/lib/idempotency";

describe("IdempotencyCache", () => {
  it("returns the cached value within the TTL and a miss after it expires", () => {
    let now = 1_000;
    const cache = new IdempotencyCache({ now: () => now }, 60_000);
    const key = IdempotencyCache.key({ tool: "create_task", args: { title: "x" }, accountId: "acct" });

    expect(cache.get(key)).toBeUndefined();
    cache.set(key, { id: "task-1" });
    expect(cache.get(key)).toEqual({ id: "task-1" });

    now += 59_000;
    expect(cache.get(key)).toEqual({ id: "task-1" });

    now += 2_000; // 61s elapsed > 60s TTL
    expect(cache.get(key)).toBeUndefined();
  });

  it("derives a stable key regardless of argument key order", () => {
    const a = IdempotencyCache.key({ tool: "t", args: { x: 1, y: 2 }, accountId: "acct" });
    const b = IdempotencyCache.key({ tool: "t", args: { y: 2, x: 1 }, accountId: "acct" });
    expect(a).toBe(b);
  });

  it("derives different keys for different tools / accounts", () => {
    const base = { args: { x: 1 } };
    expect(IdempotencyCache.key({ ...base, tool: "a", accountId: "acct" })).not.toBe(IdempotencyCache.key({ ...base, tool: "b", accountId: "acct" }));
    expect(IdempotencyCache.key({ ...base, tool: "a", accountId: "one" })).not.toBe(IdempotencyCache.key({ ...base, tool: "a", accountId: "two" }));
  });
});
