import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, scopesFor, type AppConfig } from "./config";
import { createPca } from "./auth/device-code";
import { AuthManager } from "./auth/auth-state";
import { GraphClient } from "./graph/client";
import { toAppError } from "./graph/errors";
import { systemClock } from "./lib/clock";
import { cryptoIds } from "./lib/ids";
import { createLogger } from "./lib/logger";
import { IdempotencyCache } from "./lib/idempotency";
import { TaskListsApi } from "./todo/lists";
import { TasksApi } from "./todo/tasks";
import { allTools } from "./tools/registry";
import { errorResult, okResult, type ToolContext } from "./tools/_shared";
import { VERSION } from "./version";

const IDEMPOTENCY_TTL_MS = 60_000;

export async function runServer(config: AppConfig = loadConfig()): Promise<void> {
  const logger = createLogger(config.logLevel);

  // A missing client id is a config problem, not a crash: start the server anyway and let
  // `auth_status` and any Graph-touching tool report `config_error` clearly.
  const pca = config.clientId ? createPca(config, logger) : null;
  const configError = pca ? undefined : "No Microsoft Entra client ID configured. Set MS_TODO_CLIENT_ID (see docs/ENTRA-APP-SETUP.md).";
  const auth = new AuthManager(pca, scopesFor(config), logger, () => systemClock.now(), configError);
  await auth.init();

  const graph = new GraphClient({ config, tokens: auth, logger, ids: cryptoIds });
  const ctx: ToolContext = {
    logger,
    ids: cryptoIds,
    auth,
    lists: new TaskListsApi(graph, config.maxResults),
    tasks: new TasksApi(graph, config.maxResults),
    idempotency: new IdempotencyCache(systemClock, IDEMPOTENCY_TTL_MS),
  };

  const server = new McpServer({ name: "mcp-microsoft-todo", version: VERSION });

  let registered = 0;
  let skipped = 0;
  for (const tool of allTools) {
    if (config.readonly && tool.risk !== "read") { skipped++; continue; }
    if (config.noDestructive && tool.risk === "destructive") { skipped++; continue; }
    registered++;

    server.tool(tool.name, tool.description, tool.inputShape, async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      const log = logger.child({ tool: tool.name });
      try {
        const result = await tool.handler(args, ctx);
        log.info("tool ok", { durationMs: Date.now() - startedAt, outcome: "ok" });
        return okResult(result);
      } catch (err) {
        const appError = toAppError(err);
        log.error("tool error", { durationMs: Date.now() - startedAt, outcome: "error", errorCode: appError.code });
        return errorResult(appError);
      }
    });
  }

  logger.info("mcp-microsoft-todo starting", {
    version: VERSION,
    registeredTools: registered,
    skippedTools: skipped,
    clientIdConfigured: Boolean(config.clientId),
    readonly: config.readonly,
    noDestructive: config.noDestructive,
    scopeReadonly: config.scopeReadonly,
  });

  await server.connect(new StdioServerTransport());
  // The stdio transport keeps the event loop alive; the process exits when stdin closes.
}
