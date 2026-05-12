import { describe, expect, it } from "vitest";
import { AuthManager } from "../src/auth/auth-state";
import { createLogger } from "../src/lib/logger";

const silent = createLogger("silent");

interface FakeAccount {
  username: string;
  name?: string;
  homeAccountId: string;
  tenantId: string;
}

// Minimal stand-in for the bits of PublicClientApplication AuthManager touches.
function fakePca(opts: { accounts?: FakeAccount[]; silentResult?: () => Promise<unknown> }) {
  return {
    getTokenCache: () => ({ getAllAccounts: async () => opts.accounts ?? [] }),
    acquireTokenSilent: opts.silentResult ?? (async () => { throw new Error("no_silent_token"); }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("AuthManager", () => {
  it("is uninitialized with no cached account and reports auth_required", async () => {
    const auth = new AuthManager(fakePca({}), ["Tasks.ReadWrite"], silent);
    await auth.init();
    expect(auth.status().state).toBe("uninitialized");
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
  });

  it("authenticates via a silent token when a cached account exists", async () => {
    const account: FakeAccount = { username: "u@example.com", name: "U", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => ({ accessToken: "tok-abc", expiresOn: new Date(Date.now() + 3_600_000), account }) }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    expect(auth.status().state).toBe("token_expired");
    expect(await auth.getAccessToken()).toBe("tok-abc");
    expect(auth.status().state).toBe("authenticated");
    expect(auth.accountId()).toBe("home-1");
  });

  it("caches the token until it nears expiry", async () => {
    let now = 10_000;
    let calls = 0;
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({
        accounts: [account],
        silentResult: async () => {
          calls += 1;
          return { accessToken: `tok-${calls}`, expiresOn: new Date(now + 3_600_000), account };
        },
      }),
      ["Tasks.ReadWrite"],
      silent,
      () => now,
    );
    await auth.init();
    expect(await auth.getAccessToken()).toBe("tok-1");
    now += 60_000;
    expect(await auth.getAccessToken()).toBe("tok-1"); // still cached
    expect(calls).toBe(1);
  });

  it("transitions to refresh_failed and reports auth_expired when the silent refresh throws", async () => {
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => { throw new Error("interaction_required"); } }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_expired" });
    expect(auth.status().state).toBe("refresh_failed");
  });

  it("reports config_error (and does not crash) when constructed without a client id", async () => {
    const auth = new AuthManager(null, ["Tasks.ReadWrite"], silent, undefined, "no client id configured");
    await auth.init();
    expect(auth.status()).toMatchObject({ state: "uninitialized", configError: "no client id configured" });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
  });
});
