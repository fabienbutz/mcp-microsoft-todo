import type { AccountInfo, PublicClientApplication } from "@azure/msal-node";
import { acquireByDeviceCode, type DeviceCodeInfo } from "./device-code";
import { AppError } from "../graph/errors";
import type { TokenProvider } from "../graph/client";
import type { Logger } from "../lib/logger";

/**
 * Auth for the running server. Two ways in:
 *  - a cached account → silent refresh on demand;
 *  - no account → a device-code sign-in, kicked off automatically by the first tool call that
 *    needs a token (or explicitly via the `sign_in` tool / the `login` CLI command). The poll
 *    runs in the background; the user enters a short code at a URL; the next tool call picks up
 *    the token.
 *
 *   uninitialized ─┬─ init w/ cached account ─▶ token_expired ─ silent refresh ok ─▶ authenticated
 *                  └─ sign_in / first tool call ─▶ device_code_pending ─ user completes ─▶ authenticated
 *                                 (silent refresh fails / device code expires → back to start)
 */
export type AuthState = "uninitialized" | "token_expired" | "device_code_pending" | "authenticated" | "refresh_failed";

interface PendingSignIn extends DeviceCodeInfo {
  /** Epoch ms at which the device code expires. */
  expiresAt: number;
}

export interface AuthStatus {
  state: AuthState;
  account?: { username: string; name?: string; homeAccountId: string; tenantId: string };
  tokenExpiresOn?: string;
  configError?: string;
  pendingSignIn?: { verificationUri: string; userCode: string; expiresInSeconds: number };
}

const TOKEN_SKEW_MS = 60_000;

export class AuthManager implements TokenProvider {
  private state: AuthState = "uninitialized";
  private account: AccountInfo | null = null;
  private token: { value: string; expiresOn: Date } | null = null;
  private refreshing: Promise<string> | null = null;
  private pendingSignIn: PendingSignIn | null = null;

  constructor(
    private readonly pca: PublicClientApplication | null,
    private readonly scopes: string[],
    private readonly logger: Logger,
    private readonly now: () => number = () => Date.now(),
    private readonly configError?: string,
  ) {}

  async init(): Promise<void> {
    if (!this.pca) return;
    try {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      this.account = accounts[0] ?? null;
    } catch (err) {
      this.logger.warn("token cache unreadable — treating as signed out", { error: (err as Error).message });
      this.account = null;
    }
    this.state = this.account ? "token_expired" : "uninitialized";
  }

  status(): AuthStatus {
    const out: AuthStatus = { state: this.state };
    if (this.configError) out.configError = this.configError;
    if (this.account) out.account = { username: this.account.username, name: this.account.name, homeAccountId: this.account.homeAccountId, tenantId: this.account.tenantId };
    if (this.token) out.tokenExpiresOn = this.token.expiresOn.toISOString();
    if (this.activePending()) out.pendingSignIn = this.codeInfo();
    return out;
  }

  accountId(): string {
    return this.account?.homeAccountId ?? "anonymous";
  }

  hasAccount(): boolean {
    return this.account != null;
  }

  private activePending(): boolean {
    return this.pendingSignIn != null && this.pendingSignIn.expiresAt > this.now();
  }

  private codeInfo(): { verificationUri: string; userCode: string; expiresInSeconds: number } {
    const p = this.pendingSignIn!;
    return { verificationUri: p.verificationUri, userCode: p.userCode, expiresInSeconds: Math.max(0, Math.round((p.expiresAt - this.now()) / 1000)) };
  }

  /** Begin (or reuse) a device-code sign-in. Resolves once the code is known; the poll runs in the background. */
  async signIn(): Promise<{ verificationUri: string; userCode: string; expiresInSeconds: number }> {
    if (this.configError || !this.pca) {
      throw new AppError("config_error", this.configError ?? "No Microsoft Entra client ID configured.");
    }
    if (this.activePending()) return this.codeInfo();

    const pca = this.pca;
    return new Promise((resolve, reject) => {
      const onCode = (info: DeviceCodeInfo) => {
        this.pendingSignIn = { ...info, expiresAt: this.now() + info.expiresIn * 1000 };
        this.state = "device_code_pending";
        resolve({ verificationUri: info.verificationUri, userCode: info.userCode, expiresInSeconds: info.expiresIn });
      };
      void acquireByDeviceCode(pca, this.scopes, onCode)
        .then((result) => {
          const account = result.account;
          if (!account || !result.accessToken) throw new Error("device-code result was incomplete");
          this.adopt(account, result.accessToken, result.expiresOn);
        })
        .catch((err) => {
          this.pendingSignIn = null;
          this.state = this.account ? "token_expired" : "uninitialized";
          this.logger.warn("device-code sign-in did not complete", { error: (err as Error).message });
          reject(err instanceof AppError ? err : new AppError("auth_required", `Sign-in did not complete: ${(err as Error).message}`));
        });
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.configError || !this.pca) {
      throw new AppError("config_error", this.configError ?? "No Microsoft Entra client ID configured.");
    }
    if (this.token && this.token.expiresOn.getTime() - TOKEN_SKEW_MS > this.now()) {
      return this.token.value;
    }
    if (this.account) {
      try {
        if (this.refreshing) return await this.refreshing;
        this.refreshing = this.refreshSilently(this.pca, this.account).finally(() => {
          this.refreshing = null;
        });
        return await this.refreshing;
      } catch (err) {
        // The cached session is dead — fall through to a fresh device-code sign-in.
        this.account = null;
        this.state = "refresh_failed";
        this.logger.warn("silent refresh failed — a new sign-in is needed", { error: (err as Error).message });
      }
    }
    if (this.activePending()) {
      const c = this.codeInfo();
      throw new AppError("auth_required", `Sign-in pending — open ${c.verificationUri} and enter the code ${c.userCode}, then retry.`, { details: { ...c, status: "pending" } });
    }
    const code = await this.signIn();
    throw new AppError("auth_required", `To sign in, open ${code.verificationUri} and enter the code ${code.userCode}, then retry your request.`, { details: { ...code, status: "started" } });
  }

  private async refreshSilently(pca: PublicClientApplication, account: AccountInfo): Promise<string> {
    const result = await pca.acquireTokenSilent({ account, scopes: this.scopes });
    if (!result?.accessToken) throw new Error("MSAL returned an empty token");
    this.adopt(result.account ?? account, result.accessToken, result.expiresOn);
    return result.accessToken;
  }

  /** Adopt a freshly acquired token (silent refresh or device-code sign-in). */
  adopt(account: AccountInfo, accessToken: string, expiresOn: Date | null): void {
    this.account = account;
    this.token = { value: accessToken, expiresOn: expiresOn ?? new Date(this.now() + 3_600_000) };
    this.state = "authenticated";
    this.pendingSignIn = null;
  }
}
