# microsoft-todo-mcp

[![npm](https://img.shields.io/npm/v/microsoft-todo-mcp.svg)](https://www.npmjs.com/package/microsoft-todo-mcp) [![CI](https://github.com/fabienbutz/microsoft-todo-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/fabienbutz/microsoft-todo-mcp/actions/workflows/ci.yml)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Microsoft To Do**, built on the Microsoft Graph API. Lets an MCP client (Claude Desktop, Claude Code, …) read and manage your To Do lists, tasks, and checklist items.

> **Install.** Add it to your MCP client config (below) and run `npx -y microsoft-todo-mcp login` once. No separate install — `npx` ships with Node.js. By default it authenticates with the well-known **Microsoft Graph CLI** public client id, so there's nothing to register; set `MS_TODO_CLIENT_ID` to use [your own Entra app](docs/ENTRA-APP-SETUP.md) instead. (To run an unpublished commit, use `github:fabienbutz/microsoft-todo-mcp` as the spec instead of `microsoft-todo-mcp`.)

## What it can access

Delegated Microsoft Graph scope `Tasks.ReadWrite` — **your own To Do lists and tasks, nothing else** (no mail, no files, no calendar). No telemetry, no phone-home: logs go to stderr on your machine and nowhere else. The refresh token is cached at `~/.config/microsoft-todo-mcp/token-cache.json` with `0600` permissions — treat it like an SSH key.

By default the app identity shown on the Microsoft sign-in / consent screen is *Microsoft Graph Command Line Tools* (Microsoft's well-known public client); the token it issues is still limited to `Tasks.ReadWrite`. Set `MS_TODO_CLIENT_ID` if you'd rather it be your own named app.

## Quick start

1. **Add the server to your MCP client.**

   Claude Desktop (`claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "microsoft-todo": {
         "command": "npx",
         "args": ["-y", "microsoft-todo-mcp"]
       }
     }
   }
   ```
   To use your own Entra app, add `"env": { "MS_TODO_CLIENT_ID": "<your-app-client-id>" }`. On Windows, if Claude Desktop can't find `npx`, use `"command": "cmd", "args": ["/c", "npx", "-y", "microsoft-todo-mcp"]` — see [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md).

   Claude Code:
   ```bash
   claude mcp add microsoft-todo -- npx -y microsoft-todo-mcp
   ```

2. **Restart your MCP client.** The `microsoft-todo` tools are now available.

3. **Sign in.** Ask Claude — *"sign me in to Microsoft To Do"* — or just use any tool: the server gives you a short code, you open <https://microsoft.com/devicelogin> in a browser, enter it, and approve the consent ("Microsoft Graph Command Line Tools"). The token is cached afterwards and refreshed silently. *(Prefer a terminal? `npx -y microsoft-todo-mcp login` does the same — and warms the npx cache while it's at it.)*

## Tools

| Tool | Risk | Description |
| --- | --- | --- |
| `auth_status` | read | Current sign-in state (account, token expiry, any pending sign-in). No Graph call. |
| `sign_in` | read | Start a device-code sign-in; returns a code + URL to enter, completes in the background. |
| `list_task_lists` | read | List all task lists. |
| `create_task_list` | write | Create a list. |
| `update_task_list` | write | Rename a list. |
| `delete_task_list` | destructive | Delete a list **and all its tasks**. |
| `list_tasks` | read | List tasks in a list (filter by status; expand checklist / linked resources). |
| `get_task` | read | Get one task. |
| `create_task` | write | Create a task (title, body, due/reminder date-time, importance, status, categories). |
| `update_task` | write | Update task fields; set `status: "completed"` to complete. |
| `complete_task` | write | Mark a task completed. |
| `delete_task` | destructive | Delete a task. |
| `list_checklist_items` | read | List a task's checklist items. |
| `add_checklist_item` | write | Add a checklist item. |
| `update_checklist_item` | write | Rename / check / uncheck a checklist item. |
| `delete_checklist_item` | destructive | Delete a checklist item. |

Date-time inputs accept either an ISO-8601 string (`2026-05-20T17:00:00`, interpreted in the host's timezone) or `{ "dateTime": "...", "timeZone": "Europe/Berlin" }`. Errors come back as structured `{ "error": { "code": "...", "message": "...", "requestId": "..." } }` — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the code list.

## Modes

| Flag / env | Effect |
| --- | --- |
| `--readonly` / `MS_TODO_READONLY=1` | Only `read` tools are exposed. Useful for "let Claude see my tasks but not touch them." |
| `--no-destructive` / `MS_TODO_NO_DESTRUCTIVE=1` | Hides delete tools; writes still allowed. |
| `--scope-readonly` / `MS_TODO_SCOPE_READONLY=1` | Requests only the `Tasks.Read` Graph scope (a real read-only token, not just a runtime guard — requires re-login). |

Pass flags after the package spec, e.g. `"args": ["-y", "microsoft-todo-mcp", "--readonly"]`.

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `MS_TODO_CLIENT_ID` | Microsoft Graph CLI well-known client id | Set to use your own Entra app registration (see [`docs/ENTRA-APP-SETUP.md`](docs/ENTRA-APP-SETUP.md)). |
| `MS_TODO_AUTHORITY` | `https://login.microsoftonline.com/common` | Use `.../<tenant-id>` for a single-tenant app. |
| `MS_TODO_TOKEN_CACHE` | `~/.config/microsoft-todo-mcp/token-cache.json` | Where the refresh token is stored (`0600`). |
| `MS_TODO_MAX_RESULTS` | `200` | Soft cap on items returned by list tools (page-granular). |
| `MS_TODO_GRAPH_BASE` | `https://graph.microsoft.com/v1.0` | Override for sovereign clouds / testing. |
| `LOG_LEVEL` | `info` | `silent` \| `error` \| `warn` \| `info` \| `debug`. Logs are JSON on stderr. |

CLI flags take precedence over env vars.

## CLI

```
npx -y microsoft-todo-mcp [serve]   start the MCP server on stdio (default)
npx -y microsoft-todo-mcp login     sign in via device code
npx -y microsoft-todo-mcp logout    clear the cached token
npx -y microsoft-todo-mcp whoami    show the signed-in account
npx -y microsoft-todo-mcp --version
```

## Development

```bash
git clone https://github.com/fabienbutz/microsoft-todo-mcp.git
cd microsoft-todo-mcp
npm install          # also builds dist/ via the `prepare` script
npm run typecheck
npm run lint
npm test             # vitest + fast-check
node dist/index.js login   # then `node dist/index.js` to run the server
```

Architecture and design rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Windows walkthrough: [`docs/INSTALL-WINDOWS.md`](docs/INSTALL-WINDOWS.md). Contributing (incl. the manual end-to-end smoke test): [`CONTRIBUTING.md`](CONTRIBUTING.md). Security: [`SECURITY.md`](SECURITY.md).

## License

MIT © Fabien Butz
