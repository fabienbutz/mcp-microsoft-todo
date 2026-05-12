import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Default client id: the well-known **Microsoft Graph CLI / PowerShell** public client —
 * a documented public client meant for tools that access Graph on behalf of the signed-in
 * user. Using it means the package works with zero setup; the Microsoft consent screen
 * reads "Microsoft Graph Command Line Tools" and the issued token is still scoped to the
 * requested scopes only (`Tasks.ReadWrite`). A public-client id is not a secret.
 *
 * Override with `MS_TODO_CLIENT_ID` to use your own (branded) Entra app registration —
 * see docs/ENTRA-APP-SETUP.md. Swapping in a dedicated registration here is a possible
 * follow-up (cleaner consent screen + audit attribution).
 */
const PUBLISHED_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

export interface AppConfig {
  clientId: string;
  authority: string;
  tokenCachePath: string;
  /** Request only `Tasks.Read` (true read-only capability; requires re-login). */
  scopeReadonly: boolean;
  /** Runtime guard: hide write + destructive tools. */
  readonly: boolean;
  /** Runtime guard: hide destructive (delete) tools only. */
  noDestructive: boolean;
  /** Soft cap on items returned by list tools (page-granular). */
  maxResults: number;
  graphBase: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    clientId: env.MS_TODO_CLIENT_ID ?? PUBLISHED_CLIENT_ID,
    authority: env.MS_TODO_AUTHORITY ?? "https://login.microsoftonline.com/common",
    tokenCachePath: env.MS_TODO_TOKEN_CACHE ?? join(homedir(), ".config", "mcp-microsoft-todo", "token-cache.json"),
    scopeReadonly: envBool(env.MS_TODO_SCOPE_READONLY),
    readonly: envBool(env.MS_TODO_READONLY),
    noDestructive: envBool(env.MS_TODO_NO_DESTRUCTIVE),
    maxResults: clampInt(env.MS_TODO_MAX_RESULTS, 200, 1, 1000),
    graphBase: (env.MS_TODO_GRAPH_BASE ?? "https://graph.microsoft.com/v1.0").replace(/\/+$/, ""),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}

export function scopesFor(config: AppConfig): string[] {
  // MSAL adds `offline_access` automatically for the refresh token.
  return config.scopeReadonly ? ["Tasks.Read"] : ["Tasks.ReadWrite"];
}

function envBool(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
