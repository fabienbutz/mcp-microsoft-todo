import { AppError, mapGraphError } from "./errors";
import type { AppConfig } from "../config";
import type { IdGenerator } from "../lib/ids";
import type { Logger } from "../lib/logger";

/** Supplies an access token to the Graph client; throws an `auth_*` AppError when it can't. */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Stable id of the signed-in account (for idempotency-key scoping). */
  accountId(): string;
}

export interface GraphClientDeps {
  config: AppConfig;
  tokens: TokenProvider;
  logger: Logger;
  ids: IdGenerator;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  traceId?: string;
}

const RETRYABLE_STATUS = new Set([429, 503, 504]);
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: GraphClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** `pathOrUrl` is either a path relative to the Graph base or a full URL (e.g. an `@odata.nextLink`). */
  async request<T>(method: string, pathOrUrl: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(pathOrUrl, opts.query);
    const log = this.deps.logger.child({ traceId: opts.traceId, op: `${method} ${safePath(url)}` });

    for (let attempt = 0; ; attempt++) {
      const clientRequestId = this.deps.ids.uuid();
      const token = await this.deps.tokens.getAccessToken();
      const startedAt = Date.now();

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "client-request-id": clientRequestId,
            Accept: "application/json",
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const waitMs = this.backoffMs(attempt);
          log.warn("network error, retrying", { clientRequestId, attempt, waitMs, outcome: "error" });
          await this.sleep(waitMs);
          continue;
        }
        throw new AppError("graph_unavailable", `Network error talking to Microsoft Graph: ${(err as Error).message}`, { clientRequestId });
      }

      const durationMs = Date.now() - startedAt;

      if (res.ok) {
        log.debug("graph ok", { clientRequestId, status: res.status, durationMs, outcome: "ok" });
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new AppError("graph_error", "Microsoft Graph returned a response that was not valid JSON.", { status: res.status, clientRequestId });
        }
      }

      let parsedBody: unknown;
      try {
        parsedBody = await res.json();
      } catch {
        parsedBody = undefined;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        // Honour Retry-After, but cap it — a tool call shouldn't block for minutes. If Graph
        // wants longer than the cap we still only wait the cap, then (if it keeps failing)
        // surface `rate_limited` with the server-suggested delay so the caller can retry later.
        const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : this.backoffMs(attempt);
        log.warn("retryable graph error", { clientRequestId, status: res.status, attempt, waitMs, durationMs, outcome: "error" });
        await this.sleep(waitMs);
        continue;
      }

      const error = mapGraphError(res.status, parsedBody, res.headers);
      log.error("graph error", {
        clientRequestId: error.clientRequestId ?? clientRequestId,
        requestId: error.requestId,
        status: res.status,
        durationMs,
        outcome: "error",
        errorCode: error.code,
      });
      throw error;
    }
  }

  private buildUrl(pathOrUrl: string, query?: RequestOptions["query"]): string {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : this.deps.config.graphBase + pathOrUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private backoffMs(attempt: number): number {
    const ceiling = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
    // Full jitter in [ceiling/2, ceiling].
    return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
