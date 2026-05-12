import { describe, expect, it } from "vitest";
import { GraphClient } from "../src/graph/client";
import { createLogger } from "../src/lib/logger";
import type { AppConfig } from "../src/config";

const config = { graphBase: "https://graph.microsoft.com/v1.0" } as AppConfig;
const silent = createLogger("silent");
const tokens = { getAccessToken: async () => "tok", accountId: () => "acct" };
const ids = { uuid: () => "00000000-0000-0000-0000-000000000000" };
const noSleep = async () => {};

/** A fetch that never resolves on its own — it only settles when the AbortSignal fires. */
function hangingFetch(onCall?: () => void): typeof fetch {
  return ((_url: string, opts?: { signal?: AbortSignal }) => {
    onCall?.();
    return new Promise<Response>((_resolve, reject) => {
      opts?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out.", "TimeoutError")));
    });
  }) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("GraphClient", () => {
  it("times out a hung request instead of hanging forever", async () => {
    const client = new GraphClient({ config, tokens, logger: silent, ids, requestTimeoutMs: 20, fetchImpl: hangingFetch(), sleep: noSleep });
    await expect(client.request("GET", "/me/todo/lists")).rejects.toMatchObject({ code: "graph_unavailable" });
  });

  it("does not auto-retry a POST that may have landed", async () => {
    let calls = 0;
    const client = new GraphClient({ config, tokens, logger: silent, ids, requestTimeoutMs: 20, fetchImpl: hangingFetch(() => { calls += 1; }), sleep: noSleep });
    await expect(client.request("POST", "/me/todo/lists/x/tasks", { body: { title: "t" } })).rejects.toMatchObject({ code: "graph_unavailable" });
    expect(calls).toBe(1);
  });

  it("retries a GET on a 503, then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls < 2 ? jsonResponse(503, { error: { code: "serviceUnavailable" } }) : jsonResponse(200, { value: [] });
    }) as unknown as typeof fetch;
    const client = new GraphClient({ config, tokens, logger: silent, ids, fetchImpl, sleep: noSleep });
    const res = await client.request<{ value: unknown[] }>("GET", "/me/todo/lists");
    expect(res.value).toEqual([]);
    expect(calls).toBe(2);
  });

  it("maps a 404 to not_found and carries the request id", async () => {
    const fetchImpl = (async () => jsonResponse(404, { error: { code: "ItemNotFound", message: "not found" } }, { "request-id": "req-abc-123" })) as unknown as typeof fetch;
    const client = new GraphClient({ config, tokens, logger: silent, ids, fetchImpl, sleep: noSleep });
    await expect(client.request("GET", "/me/todo/lists/nope")).rejects.toMatchObject({ code: "not_found", requestId: "req-abc-123" });
  });

  it("returns undefined for a 204 (no body)", async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new GraphClient({ config, tokens, logger: silent, ids, fetchImpl, sleep: noSleep });
    expect(await client.request("DELETE", "/me/todo/lists/x/tasks/y")).toBeUndefined();
  });
});
