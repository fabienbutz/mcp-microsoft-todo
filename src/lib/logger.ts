/**
 * Tiny structured logger. Writes JSON lines to **stderr** — stdout is reserved for the
 * MCP protocol stream on a stdio transport, so nothing chatty may ever touch it.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LEVELS = new Set<string>(["silent", "error", "warn", "info", "debug"]);

const REDACT_KEYS = new Set(["authorization", "access_token", "accesstoken", "refresh_token", "refreshtoken", "id_token", "token", "bearer", "secret", "password"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  traceId?: string;
  clientRequestId?: string;
  requestId?: string;
  tool?: string;
  op?: string;
  durationMs?: number;
  status?: number;
  attempt?: number;
  waitMs?: number;
  outcome?: "ok" | "error";
  errorCode?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly level: LogLevel, private readonly base: LogFields = {}) {}

  child(fields: LogFields): Logger {
    return new Logger(this.level, { ...this.base, ...fields });
  }

  error(msg: string, fields?: LogFields): void { this.write("error", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.write("warn", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.write("info", msg, fields); }
  debug(msg: string, fields?: LogFields): void { this.write("debug", msg, fields); }

  private write(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields = {}): void {
    if (ORDER[level] > ORDER[this.level]) return;
    const line = { level, time: new Date().toISOString(), msg, ...(redact({ ...this.base, ...fields }) as object) };
    process.stderr.write(JSON.stringify(line) + "\n");
  }
}

export function createLogger(level: string | undefined): Logger {
  const lvl = (level && LEVELS.has(level) ? level : "info") as LogLevel;
  return new Logger(lvl);
}
