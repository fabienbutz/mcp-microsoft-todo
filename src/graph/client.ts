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
  /** Per-request timeout in ms (default 15s). Mostly here so tests can use a short one. */
  requestTimeoutMs?: number;
  /** Overrides for tests. */
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
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestTimeoutMs: number;

  constructor(private readonly deps: GraphClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** `pathOrUrl` is either a path relative to the Graph base or a full URL (e.g. an `@odata.nextLink`). */
  async request<T>(method: string, pathOrUrl: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(pathOrUrl, opts.query);
    const log = this.deps.logger.child({ traceId: opts.traceId, op: `${method} ${safePath(url)}` });
    // A POST may have reached Graph even if we never saw the response — never auto-retry one
    // on a transport-level failure (timeout / connection error / body read error). The caller
    // can retry the tool call; the per-tool idempotency cache absorbs the duplicate.
    const retrySafeOnTransportFailure = method.toUpperCase() !== "POST";

    for (let attempt = 0; ; attempt++) {
      const clientRequestId = this.deps.ids.uuid();
      const token = await this.deps.tokens.getAccessToken();
      const startedAt = Date.now();

      let res: Response;
      let bodyText: string;
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
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        bodyText = await res.text();
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        if (retrySafeOnTransportFailure && attempt < MAX_RETRIES) {
          const waitMs = this.backoffMs(attempt);
          log.warn(timedOut ? "request timed out — retrying" : "transport error — retrying", { clientRequestId, attempt, waitMs, outcome: "error" });
          await this.sleep(waitMs);
          continue;
        }
        throw new AppError(
          "graph_unavailable",
          timedOut
            ? `Microsoft Graph did not respond within ${Math.round(this.requestTimeoutMs / 1000)}s.`
            : `Network error talking to Microsoft Graph: ${(err as Error).message}`,
          { clientRequestId },
        );
      }

      const durationMs = Date.now() - startedAt;

      if (res.ok) {
        log.debug("graph ok", { clientRequestId, status: res.status, durationMs, outcome: "ok" });
        if (!bodyText) return undefined as T;
        try {
          return JSON.parse(bodyText) as T;
        } catch {
          throw new AppError("graph_error", "Microsoft Graph returned a response that was not valid JSON.", { status: res.status, clientRequestId });
        }
      }

      let parsedBody: unknown;
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
      } catch {
        parsedBody = undefined;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        // 429/503/504 mean the request was not processed — safe to retry even for a POST.
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        // Honour Retry-After, but cap it — a tool call shouldn't block for minutes.
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
