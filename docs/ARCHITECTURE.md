# Architecture

A small OSS MCP server doesn't need a payments-grade stack — but it benefits from going through the same checklist a payments-grade service would, taking the parts that translate and dropping the rest *with a reason*. Being honest about what we can and can't guarantee is the point.

## 1. Pattern checklist

| Pattern | Here | How |
| --- | --- | --- |
| Idempotency keys | ✅ scaled | In-process TTL cache for `create_*` (`src/lib/idempotency.ts`). No server to persist keys → best-effort, restart-window documented, not hidden. |
| Event stream as a first-class resource | ❌ | Stateless tool wrapper, no event store. (Graph change-notifications → maybe v0.4.) |
| Cursor pagination (no offsets) | ✅ | `@odata.nextLink` iterator (`src/graph/pagination.ts`); list tools return `hasMore` + an opaque `cursor`, never page numbers. |
| Error taxonomy + request id | ✅ | Stable `code` strings (`src/graph/errors.ts`) + Graph `request-id` / `client-request-id` on every error. |
| Distributed tracing | ⚠️ local / opt-in | A `traceId` per tool call and a fresh `client-request-id` per Graph call, both logged. No OpenTelemetry export by default (no phone-home). |
| Resource expansion | ✅ light | `includeChecklist` / `includeLinkedResources` → `$expand`; saves the model a round-trip. |
| Webhook delivery mesh | ❌ | Out of scope. |
| Double-entry ledger | ❌ | No money. |
| Property-based tests on state machines | ✅ | Auth state machine, pagination merge, idempotency cache are property/contract tested (`test/`, `fast-check`). |
| Deterministic tests | ✅ | Injectable clock (`src/lib/clock.ts`), id generator (`src/lib/ids.ts`), `fetch`, and token cache. |
| Single source of truth for the API surface | ✅ scaled | Zod is the source: tool input schemas → handler types via `z.infer` → the MCP registration. `src/tools/registry.ts` is the one list; risk class lives there too. |
| Correlation IDs end to end | ✅ | See "distributed tracing" above. |
| Schema evolution / backwards compat | ✅ light | Tool names are stable; a breaking change means a new tool or a new *optional* parameter, never a repurpose. Graph pinned to `v1.0`, never `beta`. |
| Thin adapters over a shared business layer | ✅ | The MCP layer (`src/tools/`) is a thin adapter over the To Do domain (`src/todo/`) over the Graph HTTP layer (`src/graph/`). The domain layer would be reusable from a CLI or REST wrapper. |

MCP-specific addition: **risk classification per tool** (`read` / `write` / `destructive`) → `--readonly` and `--no-destructive` runtime modes; destructive tools say so in their description.

## 2. Layers

```
src/
  index.ts          CLI dispatch: serve | login | logout | whoami | --version | --help
  server.ts         MCP server: builds the context, registers tools (filtered by risk), stdio transport
  config.ts         env → AppConfig (default + override of the Graph client id)
  version.ts        single version constant

  auth/
    device-code.ts   MSAL PublicClientApplication + device-code login
    token-cache.ts   ICachePlugin → file at ~/.config/mcp-microsoft-todo/ (0600)
    auth-state.ts    AuthManager — the explicit auth state machine + TokenProvider
  graph/
    client.ts        fetch + Bearer + client-request-id + retry/throttle + error mapping
    errors.ts        AppError + ErrorCode taxonomy + mapGraphError
    pagination.ts    @odata.nextLink iterator, opaque cursor encode/decode
  todo/              domain layer — knows To Do, not MCP
    types.ts         Zod schemas for TaskList / Task / ChecklistItem (.passthrough for forward-compat)
    lists.ts         TaskListsApi
    tasks.ts         TasksApi (tasks + checklist items)
  tools/             MCP adapter — thin: validated args → todo/* → JSON result; AppError → MCP error
    _shared.ts       ToolContext, defineTool, ok/error result, withIdempotency
    registry.ts      allTools — the single source of truth for the surface
    auth-tools.ts · list-tools.ts · task-tools.ts · checklist-tools.ts
  lib/
    logger.ts        ~tiny structured JSON logger → STDERR (stdout is the MCP channel)
    ids.ts · clock.ts   injectable
    idempotency.ts   the TTL cache
    schema.ts        shared Zod pieces (date-time coercion, importance, status)

test/                vitest + fast-check
docs/                this file, ENTRA-APP-SETUP.md
.github/workflows/   ci.yml
```

Dependency direction: `tools/` → `todo/` + `lib/`; `todo/` → `graph/` + `lib/`; `graph/` → `lib/`; `auth/` is self-contained (+ `lib/`, msal); `lib/` depends on nothing internal. (Not yet machine-enforced — a small eslint `no-restricted-imports` config is a v0.2 nicety.)

## 3. Auth

Explicit state machine in `AuthManager` (`src/auth/auth-state.ts`):

```
uninitialized ──init w/ cached account──▶ token_expired ──silent refresh ok──▶ authenticated
      ▲                                         │                                  │
      └────────── no cached account ────────────┴──────── refresh fails ────────────┘ (refresh_failed)
```

- **Login** is a separate CLI command (`mcp-microsoft-todo login`) using the device-code flow — never raced inside a tool call. Public client → **no client secret anywhere**. In `serve`, a tool call that needs a token but can't get one returns a structured `auth_required` / `auth_expired` error telling the user to run `login`; the server never pops a device-code prompt on its own.
- **Scopes:** `Tasks.ReadWrite` by default; `--scope-readonly` requests only `Tasks.Read` (a genuinely read-only token, not just a runtime gate). `offline_access` is added by MSAL for the refresh token.
- **Token cache:** MSAL `ICachePlugin` → JSON file with `0600` perms (`MS_TODO_TOKEN_CACHE` to relocate). Refresh token = the sensitive artifact; treat the file like an SSH key. (OS-keychain storage via `keytar` is a deliberate non-default — native-dependency friction, especially on Linux/CI; planned as opt-in for v0.3.)
- **Accounts:** the default client id is Microsoft's well-known *Graph CLI* public client (multi-tenant + personal Microsoft accounts), authority `…/common`; `MS_TODO_CLIENT_ID` swaps in your own registration. Personal `@outlook.com` To Do works.

## 4. Graph HTTP layer

`src/graph/client.ts` — one method, `request<T>(method, pathOrUrl, { query, body, traceId })`; `pathOrUrl` is a path relative to `MS_TODO_GRAPH_BASE` (default `https://graph.microsoft.com/v1.0`) or a full URL (an `@odata.nextLink`).

- Every call carries `Authorization: Bearer …` and a fresh `client-request-id` GUID. The response `request-id` / `client-request-id` are logged and threaded into errors — that's what you give Microsoft support.
- **Retry / throttle:** `429` (honours `Retry-After`), `503`, `504`, and network errors → exponential backoff with full jitter, ≤ 3 retries, then `rate_limited` / `graph_unavailable`. POSTs are safe to retry on `429` (the first one didn't land); the "timeout after a maybe-successful POST" case is exactly what the idempotency cache (§6) covers.
- **Pagination:** `collectPages` follows `@odata.nextLink` until at least `maxResults` items (page-granular — never splits a page, so the result may slightly exceed the cap) or no next link; if stopped by the cap, returns a resumable opaque cursor (`hasMore: true`, `cursor`).

## 5. Tools

15 tools, one shape (`_shared.ts`: validated args → `todo/*` → `okResult(JSON)`; thrown `AppError` → `errorResult` with `isError: true`). See the table in the README. Risk class is declared on each tool and used by `server.ts` to honour `--readonly` / `--no-destructive`. `create_*` tools go through `withIdempotency`.

## 6. Idempotency

`src/lib/idempotency.ts` — in-process `Map`, key = `sha256(tool ‖ stableJSON(args) ‖ accountId)`, TTL 60 s. On a hit, `create_*` returns the cached result tagged `_idempotent: true` instead of creating a duplicate; on a miss it calls Graph and stores the result. **Honest limitation:** it does not survive a process restart (Stripe persists keys server-side for 24 h — we have no server). Restart-then-immediately-retry-the-same-create is rare; that's the trade.

## 7. Error taxonomy

`ErrorCode` (`src/graph/errors.ts`): `auth_required`, `auth_expired`, `config_error`, `permission_denied`, `not_found`, `conflict`, `validation_error`, `rate_limited`, `graph_unavailable`, `graph_error`, `internal_error`. Shape: `{ code, message, requestId?, clientRequestId?, retryAfterSeconds?, status?, details? }`. Returned to the MCP client as `{ content: [{ type: "text", text: JSON }], isError: true }` so the model can branch on `code` (e.g. `auth_required` → tell the user to run `login`).

## 8. Observability

`src/lib/logger.ts` — structured JSON lines to **stderr** (an eslint rule blocks `console.log`; stdout is the protocol stream). Fields: `level, time, msg, traceId, clientRequestId, requestId, tool, op, durationMs, status, attempt, waitMs, outcome, errorCode`. `LOG_LEVEL` env (`silent`…`debug`). Token-like keys are redacted recursively; task bodies are not logged at `info`. No telemetry / phone-home by default; an opt-in OpenTelemetry exporter (`OTEL_EXPORTER_OTLP_ENDPOINT`) is planned for v0.3.

## 9. Security posture

No client secret (public client). Token cache `0600`, refresh token treated like an SSH key. Minimal scopes (`Tasks.ReadWrite` — your own tasks, nothing else); `--readonly` is a UX/defense-in-depth runtime guard, `--scope-readonly` is the real boundary (`Tasks.Read` token). No telemetry. Token redaction in all logs/errors. Dependency minimalism: runtime deps are just `@modelcontextprotocol/sdk`, `@azure/msal-node`, `zod` (HTTP via native `fetch`, logging hand-rolled). `npm publish --provenance` from CI on tags (supply-chain attestation). Disclosure process: see [`../SECURITY.md`](../SECURITY.md).

## 10. Config & CLI

Env: `MS_TODO_CLIENT_ID`, `MS_TODO_AUTHORITY`, `MS_TODO_TOKEN_CACHE`, `MS_TODO_READONLY`, `MS_TODO_NO_DESTRUCTIVE`, `MS_TODO_SCOPE_READONLY`, `MS_TODO_MAX_RESULTS`, `MS_TODO_GRAPH_BASE`, `LOG_LEVEL`. CLI flags (`--readonly`, `--no-destructive`, `--scope-readonly`) take precedence (they set the corresponding env var before `loadConfig`). Commands: `serve` (default), `login`, `logout`, `whoami`, `--version`, `--help`. (A `config.json` file with precedence below env is planned for v0.3.)

## 11. Tests

`test/` (vitest + fast-check): cursor round-trip + `collectPages` properties (concatenation/order/no-dupes, soft-cap + resumable cursor, cursor resume); idempotency cache (TTL hit/miss, key stability/separation); auth state machine (uninitialized → auth_required, cached account → silent token → authenticated, token caching, refresh failure → refresh_failed → auth_expired). Determinism via injected clock/ids/fetch. **Planned:** full property test of the retry/backoff loop and a `nock`/`msw` contract suite for `todo/*` against recorded Graph fixtures; a documented manual end-to-end smoke (`login` + create/complete/delete against a test account) in `CONTRIBUTING.md`.

## 12. CI/CD & packaging

`.github/workflows/ci.yml`: on push/PR → `npm ci → typecheck → lint → test → build` on Node 20 and 22. Build via `tsup` → ESM, shebang banner, single-file `dist/index.js`; `bin` → `mcp-microsoft-todo`; `files` allowlist limits the published tarball to `dist`, `docs`, `README`, `LICENSE`. **Planned:** a `release.yml` on `v*` tags doing `npm publish --provenance` (needs `id-token: write` + `NPM_TOKEN`), a generated `docs/TOOLS.md` with a CI drift check, and a `version.ts` ↔ `package.json` sync check.

## 13. Roadmap

- **v0.1 (this):** auth (device code + cache + state machine + `login`/`logout`/`whoami`), Graph client (retry/throttle/error taxonomy/pagination), lists + tasks + checklist tools (15), `--readonly` / `--no-destructive` / `--scope-readonly`, structured logging, idempotency cache, the test seed, README + Entra setup, basic CI. Ships with the well-known Microsoft Graph CLI public client id by default (overridable via `MS_TODO_CLIENT_ID`); a dedicated registration is a possible follow-up.
- **v0.2:** contract test suite (`msw` + fixtures) + retry-loop property test; `no-restricted-imports` layer rules; generated `docs/TOOLS.md` + drift check; MCP tool annotations (`readOnlyHint`/`destructiveHint`).
- **v0.3:** `--keychain` (keytar) opt-in; `Tasks.ReadWrite.Shared`; `config.json` support; `linkedResources` read; recurrence (`patternedRecurrence`) on create/update; opt-in OpenTelemetry.
- **v0.4+ (demand-driven):** multi-account (`--account`); sovereign-cloud endpoints; Graph change-notification subscription surfaced as an MCP resource; optional HTTP transport.
