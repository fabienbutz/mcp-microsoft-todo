import type { AccountInfo, PublicClientApplication } from "@azure/msal-node";
import { AppError } from "../graph/errors";
import type { TokenProvider } from "../graph/client";
import type { Logger } from "../lib/logger";

/**
 * Explicit auth state machine for the running server.
 *
 *   uninitialized ──init w/ cached account──▶ token_expired ──silent refresh ok──▶ authenticated
 *        ▲                                          │                                   │
 *        └────── no cached account / refresh fails ─┴──────── refresh fails ─────────────┘ (refresh_failed)
 *
 * (`device_code_pending` lives only in the `login` CLI command, never here.) When no client
 * id is configured the manager stays in `uninitialized` and every token request reports
 * `config_error` — the server runs, it just can't talk to Graph until configured.
 */
export type AuthState = "uninitialized" | "token_expired" | "authenticated" | "refresh_failed";

export interface AuthStatus {
  state: AuthState;
  account?: { username: string; name?: string; homeAccountId: string; tenantId: string };
  tokenExpiresOn?: string;
  configError?: string;
}

const TOKEN_SKEW_MS = 60_000;

export class AuthManager implements TokenProvider {
  private state: AuthState = "uninitialized";
  private account: AccountInfo | null = null;
  private token: { value: string; expiresOn: Date } | null = null;
  private refreshing: Promise<string> | null = null;

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
    return {
      state: this.state,
      ...(this.configError ? { configError: this.configError } : {}),
      ...(this.account
        ? { account: { username: this.account.username, name: this.account.name, homeAccountId: this.account.homeAccountId, tenantId: this.account.tenantId } }
        : {}),
      ...(this.token ? { tokenExpiresOn: this.token.expiresOn.toISOString() } : {}),
    };
  }

  accountId(): string {
    return this.account?.homeAccountId ?? "anonymous";
  }

  async getAccessToken(): Promise<string> {
    if (this.configError || !this.pca) {
      throw new AppError("config_error", this.configError ?? "No Microsoft Entra client ID configured.");
    }
    if (this.token && this.token.expiresOn.getTime() - TOKEN_SKEW_MS > this.now()) {
      return this.token.value;
    }
    if (!this.account) {
      this.state = "uninitialized";
      throw new AppError("auth_required", "Not signed in. Run `microsoft-todo-mcp login` first.");
    }
    // Single-flight: concurrent tool calls share one silent refresh.
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshSilently(this.pca, this.account).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshSilently(pca: PublicClientApplication, account: AccountInfo): Promise<string> {
    try {
      const result = await pca.acquireTokenSilent({ account, scopes: this.scopes });
      if (!result?.accessToken) throw new Error("MSAL returned an empty token");
      this.adopt(result.account ?? account, result.accessToken, result.expiresOn);
      return result.accessToken;
    } catch (err) {
      this.state = "refresh_failed";
      this.logger.warn("silent token refresh failed", { error: (err as Error).message });
      throw new AppError("auth_expired", "Session expired and could not be refreshed. Run `microsoft-todo-mcp login` again.");
    }
  }

  /** Adopt a freshly acquired token (from silent refresh or an interactive login). */
  adopt(account: AccountInfo, accessToken: string, expiresOn: Date | null): void {
    this.account = account;
    this.token = { value: accessToken, expiresOn: expiresOn ?? new Date(this.now() + 3_600_000) };
    this.state = "authenticated";
  }
}
