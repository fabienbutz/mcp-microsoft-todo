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

const DEVICE_CODE = {
  userCode: "ABCD-EFGH",
  verificationUri: "https://microsoft.com/devicelogin",
  message: "To sign in, open https://microsoft.com/devicelogin and enter the code ABCD-EFGH",
  expiresIn: 900,
};

function fakePca(
  opts: {
    accounts?: FakeAccount[];
    silentResult?: () => Promise<unknown>;
    /** Resolves to an AuthenticationResult, rejects, or never settles (default: never — poll pending). */
    deviceCodeResult?: () => Promise<unknown>;
    onDeviceCodeCall?: () => void;
  } = {},
) {
  return {
    getTokenCache: () => ({ getAllAccounts: async () => opts.accounts ?? [] }),
    acquireTokenSilent: opts.silentResult ?? (async () => { throw new Error("no_silent_token"); }),
    acquireTokenByDeviceCode: async ({ deviceCodeCallback }: { deviceCodeCallback: (info: typeof DEVICE_CODE) => void; scopes: string[] }) => {
      opts.onDeviceCodeCall?.();
      deviceCodeCallback(DEVICE_CODE);
      return (opts.deviceCodeResult ?? (() => new Promise(() => {})))();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("AuthManager", () => {
  it("starts uninitialized with no cached account", async () => {
    const auth = new AuthManager(fakePca(), ["Tasks.ReadWrite"], silent);
    await auth.init();
    expect(auth.status().state).toBe("uninitialized");
    expect(auth.hasAccount()).toBe(false);
  });

  it("getAccessToken with no account starts a device-code sign-in and reports the code", async () => {
    const auth = new AuthManager(fakePca(), ["Tasks.ReadWrite"], silent);
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({
      code: "auth_required",
      details: { userCode: "ABCD-EFGH", verificationUri: "https://microsoft.com/devicelogin", status: "started" },
    });
    expect(auth.status().state).toBe("device_code_pending");
    expect(auth.status().pendingSignIn?.userCode).toBe("ABCD-EFGH");
  });

  it("a second getAccessToken while a sign-in is pending reports it pending, without starting a new flow", async () => {
    let deviceCodeCalls = 0;
    const auth = new AuthManager(fakePca({ onDeviceCodeCall: () => { deviceCodeCalls += 1; } }), ["Tasks.ReadWrite"], silent);
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ details: { status: "started" } });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ details: { status: "pending", userCode: "ABCD-EFGH" } });
    expect(deviceCodeCalls).toBe(1);
  });

  it("signIn returns the device code; once the background poll resolves, getAccessToken returns the token", async () => {
    const account: FakeAccount = { username: "u@example.com", name: "U", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ deviceCodeResult: async () => ({ accessToken: "tok-device", account, expiresOn: new Date(Date.now() + 3_600_000) }) }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    const code = await auth.signIn();
    expect(code.userCode).toBe("ABCD-EFGH");
    expect(auth.status().state).toBe("device_code_pending");
    await tick();
    expect(await auth.getAccessToken()).toBe("tok-device");
    expect(auth.status().state).toBe("authenticated");
    expect(auth.accountId()).toBe("home-1");
  });

  it("authenticates via a silent token when a cached account exists", async () => {
    const account: FakeAccount = { username: "u@example.com", name: "U", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => ({ accessToken: "tok-silent", expiresOn: new Date(Date.now() + 3_600_000), account }) }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    expect(auth.status().state).toBe("token_expired");
    expect(await auth.getAccessToken()).toBe("tok-silent");
    expect(auth.status().state).toBe("authenticated");
  });

  it("caches the access token until it nears expiry", async () => {
    let now = 10_000;
    let calls = 0;
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => { calls += 1; return { accessToken: `tok-${calls}`, expiresOn: new Date(now + 3_600_000), account }; } }),
      ["Tasks.ReadWrite"],
      silent,
      () => now,
    );
    await auth.init();
    expect(await auth.getAccessToken()).toBe("tok-1");
    now += 60_000;
    expect(await auth.getAccessToken()).toBe("tok-1");
    expect(calls).toBe(1);
  });

  it("when the silent refresh fails, falls back to a device-code sign-in", async () => {
    const account: FakeAccount = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };
    const auth = new AuthManager(
      fakePca({ accounts: [account], silentResult: async () => { throw new Error("interaction_required"); } }),
      ["Tasks.ReadWrite"],
      silent,
    );
    await auth.init();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required", details: { userCode: "ABCD-EFGH" } });
    expect(auth.status().state).toBe("device_code_pending");
  });

  it("reports config_error and never signs in when constructed without a client id", async () => {
    const auth = new AuthManager(null, ["Tasks.ReadWrite"], silent, undefined, "no client id configured");
    await auth.init();
    expect(auth.status()).toMatchObject({ state: "uninitialized", configError: "no client id configured" });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
    await expect(auth.signIn()).rejects.toMatchObject({ code: "config_error" });
  });
});
