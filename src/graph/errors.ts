/** Stable, machine-readable error taxonomy. The `code` is what callers (and LLMs) branch on. */
export type ErrorCode =
  | "auth_required"
  | "auth_expired"
  | "config_error"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "rate_limited"
  | "graph_unavailable"
  | "graph_error"
  | "internal_error";

export interface AppErrorJSON {
  code: ErrorCode;
  message: string;
  requestId?: string;
  clientRequestId?: string;
  retryAfterSeconds?: number;
  status?: number;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly requestId?: string;
  readonly clientRequestId?: string;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, extra: Omit<Partial<AppErrorJSON>, "code" | "message"> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.requestId = extra.requestId;
    this.clientRequestId = extra.clientRequestId;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.status = extra.status;
    this.details = extra.details;
  }

  toJSON(): AppErrorJSON {
    const out: AppErrorJSON = { code: this.code, message: this.message };
    if (this.requestId) out.requestId = this.requestId;
    if (this.clientRequestId) out.clientRequestId = this.clientRequestId;
    if (this.retryAfterSeconds != null) out.retryAfterSeconds = this.retryAfterSeconds;
    if (this.status != null) out.status = this.status;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", err instanceof Error ? err.message : String(err));
}

interface GraphErrorBody {
  error?: { code?: string; message?: string; innerError?: Record<string, unknown> };
}

/** Map a Graph HTTP error response onto the taxonomy. */
export function mapGraphError(status: number, body: unknown, headers: Headers): AppError {
  const requestId = headers.get("request-id") ?? undefined;
  const clientRequestId = headers.get("client-request-id") ?? undefined;
  const graph = (body as GraphErrorBody | undefined)?.error;
  const graphCode = graph?.code;
  const message = graph?.message || `Microsoft Graph request failed (HTTP ${status})`;
  const base = { requestId, clientRequestId, status, details: graphCode ? { graphCode } : undefined };

  switch (status) {
    case 401:
      return new AppError("auth_expired", "Microsoft rejected the access token (401). Run `mcp-microsoft-todo login` again.", base);
    case 403:
      return new AppError("permission_denied", message, base);
    case 404:
      return new AppError("not_found", message, base);
    case 409:
    case 412:
      return new AppError("conflict", message, base);
    case 429: {
      const ra = Number.parseInt(headers.get("retry-after") ?? "", 10);
      return new AppError("rate_limited", "Microsoft Graph throttled the request (429).", {
        ...base,
        retryAfterSeconds: Number.isFinite(ra) ? ra : undefined,
      });
    }
    case 503:
    case 504:
      return new AppError("graph_unavailable", message, base);
    default:
      return new AppError("graph_error", message, base);
  }
}
