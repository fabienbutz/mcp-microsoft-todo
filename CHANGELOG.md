# Changelog

Notable changes to this project. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); versioning per [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-05-12

Initial release. Published on npm as `microsoft-todo-mcp` — run it with `npx -y microsoft-todo-mcp`
(also runnable from a GitHub checkout: `npx -y github:fabienbutz/microsoft-todo-mcp`). Authenticates with
the well-known Microsoft Graph CLI public client id by default (overridable via `MS_TODO_CLIENT_ID`).

### Added
- Device-code authentication (MSAL public client — no client secret), file token cache at
  `~/.config/microsoft-todo-mcp/token-cache.json` (`0600`), explicit `AuthManager` state machine
  with single-flight refresh; tolerates a missing or corrupt cache file.
- Microsoft Graph HTTP client: per-call `client-request-id`, retry/throttle with full-jitter
  backoff (capped `Retry-After`), stable error taxonomy with request ids, `@odata.nextLink`
  cursor pagination with a non-termination guard.
- Domain layer for To Do task lists / tasks / checklist items (Zod-validated, forward-compatible).
- 15 MCP tools with `read` / `write` / `destructive` risk classes; runtime modes `--readonly`,
  `--no-destructive`, `--scope-readonly`.
- In-process idempotency cache for `create_*` operations (best-effort; does not survive a restart).
- Structured JSON logging to stderr with recursive token redaction.
- CLI: `serve` (default), `login`, `logout`, `whoami`, `--version`, `--help`.
- Tests (vitest + fast-check): pagination properties, idempotency cache, auth state machine,
  tool-registry invariants, version sync. CI on Node 20 and 22.
