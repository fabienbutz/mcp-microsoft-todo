import { z } from "zod";
import { AppError, toAppError } from "../graph/errors";
import { IdempotencyCache } from "../lib/idempotency";
import type { IdGenerator } from "../lib/ids";
import type { Logger } from "../lib/logger";
import type { AuthManager } from "../auth/auth-state";
import type { TaskListsApi } from "../todo/lists";
import type { TasksApi } from "../todo/tasks";

export type RiskClass = "read" | "write" | "destructive";

/** Everything a tool handler needs. Constructed once in `server.ts`. */
export interface ToolContext {
  logger: Logger;
  ids: IdGenerator;
  auth: AuthManager;
  lists: TaskListsApi;
  tasks: TasksApi;
  idempotency: IdempotencyCache;
}

/** Erased tool definition used by the registry / server. */
export interface ToolDef {
  name: string;
  description: string;
  risk: RiskClass;
  /** Zod raw shape — passed straight to `server.tool()`. */
  inputShape: z.ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Define a tool with the handler type-checked against its input schema, then erase. */
export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  risk: RiskClass;
  input: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}): ToolDef {
  return {
    name: def.name,
    description: def.description,
    risk: def.risk,
    inputShape: def.input,
    handler: def.handler as ToolDef["handler"],
  };
}

const TEXT = "text" as const;

export function okResult(data: unknown) {
  return { content: [{ type: TEXT, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(err: unknown) {
  const appError = err instanceof AppError ? err : toAppError(err);
  return { content: [{ type: TEXT, text: JSON.stringify({ error: appError.toJSON() }, null, 2) }], isError: true as const };
}

/**
 * Wrap a mutating operation in the in-process idempotency cache. On a cache hit the cached
 * result is returned, tagged `_idempotent: true` so the caller knows nothing new was created.
 */
export async function withIdempotency<T>(ctx: ToolContext, tool: string, args: unknown, run: () => Promise<T>): Promise<unknown> {
  const key = IdempotencyCache.key({ tool, args, accountId: ctx.auth.accountId() });
  const cached = ctx.idempotency.get(key);
  if (cached !== undefined) {
    return cached && typeof cached === "object" && !Array.isArray(cached) ? { ...(cached as object), _idempotent: true } : cached;
  }
  const result = await run();
  ctx.idempotency.set(key, result);
  return result;
}
