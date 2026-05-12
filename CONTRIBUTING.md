# Contributing

Thanks for taking a look. This is a small, focused server — the bar is "clean and honest" over "feature-complete".

## Setup

```bash
npm install
npm run build       # tsup → dist/index.js
npm run typecheck
npm run lint
npm test            # vitest + fast-check
```

Node 20+ required.

## Conventions

- **Never write to stdout from the server path.** Stdout is the MCP protocol stream on a stdio transport. Use the logger (which writes to stderr) or `console.error`. An eslint rule (`no-console` allowing only `error`/`warn`) guards this. The CLI commands (`login`/`logout`/`whoami`) may use stdout — they're not the server.
- **Keep the layers honest:** `tools/` → `todo/` → `graph/` → `lib/`; `auth/` is self-contained. Don't reach across.
- **Zod is the source of truth** for the tool surface. Add tools in `src/tools/*-tools.ts` via `defineTool`, with a `risk` class, and they'll be picked up by `src/tools/registry.ts`. Mutating (`create_*`) tools should go through `withIdempotency`.
- **Errors:** throw `AppError` with a code from the taxonomy in `src/graph/errors.ts`. The server turns it into a structured MCP error automatically.
- Conventional-style commit messages are appreciated but not enforced.

## Tests

Unit/property/contract tests live in `test/`. Time, ids, `fetch`, and the token cache are injectable — tests should never hit the real network or the real clock. Run `npm test`; `fast-check` seeds are deterministic in CI.

### Manual end-to-end smoke (not in CI)

This needs a real (ideally throwaway) Microsoft 365 / personal account and an Entra app (see `docs/ENTRA-APP-SETUP.md`):

```bash
npm run build
export MS_TODO_CLIENT_ID=<your-app-client-id>
node dist/index.js login                 # device code
node dist/index.js whoami                # confirms the account
# then point an MCP client (or the MCP Inspector) at `node dist/index.js` and exercise:
#   list_task_lists → create_task_list → create_task → add_checklist_item →
#   complete_task → delete_task → delete_task_list
node dist/index.js logout
```

## CI

`npm ci → typecheck → lint → test → build` on Node 20 and 22 (`.github/workflows/ci.yml`). Please make sure all of those pass locally before opening a PR.
