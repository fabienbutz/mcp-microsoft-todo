# Installing on Windows

The standard way to run `mcp-microsoft-todo` is via `npx` straight from this GitHub repo — no separate install, just Node.js (**Option A** below). **Option B** keeps a local checkout instead (handy if you want to hack on it or run offline). (On macOS/Linux it's the same — only the Claude Desktop config-file location differs; see the [README](../README.md).)

## Prerequisite (both options)

**Node.js** ≥ 20 (LTS) — <https://nodejs.org> → the green **LTS** button → run the installer (defaults are fine). **Open a fresh terminal afterwards** so `node`/`npx` are on your `PATH`. That's the only thing to install — `npx` (which runs the server) comes with Node.

> If PowerShell refuses to run `npm`/`npx` with an execution-policy error, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once (confirm with `Y`), or use Command Prompt (`cmd`) instead.

## Option A — run via `npx`, no build (recommended)

1. **Sign in once** — in PowerShell or Command Prompt:
   ```powershell
   npx -y github:fabienbutz/mcp-microsoft-todo login
   ```
   The **first** run is slow (~30–60s — npx clones the repo, installs dependencies, builds it); after that it's cached. It then prints something like *"To sign in, use a web browser to open https://microsoft.com/devicelogin and enter the code ABCD-EFGH"*. Open that URL, sign in with your Microsoft account, enter the code, and approve the consent — it shows as **"Microsoft Graph Command Line Tools — Read and write your tasks"** (Microsoft's well-known tool client; the issued token is still limited to `Tasks.ReadWrite`). On success: *"Signed in as …"*. The token is cached at `C:\Users\<you>\.config\mcp-microsoft-todo\token-cache.json`.

2. **Configure Claude Desktop** — edit `%APPDATA%\Claude\claude_desktop_config.json` (press Win+R, type `%APPDATA%\Claude`, open `claude_desktop_config.json` in a text editor; create the file/folder if missing). Add the `microsoft-todo` entry — **if there's already an `mcpServers` block, merge into it, don't replace it:**
   ```json
   {
     "mcpServers": {
       "microsoft-todo": {
         "command": "npx",
         "args": ["-y", "github:fabienbutz/mcp-microsoft-todo"]
       }
     }
   }
   ```
   If Claude Desktop reports it can't start (`npx` not found — happens on some Windows setups), use this form instead:
   ```json
       "microsoft-todo": {
         "command": "cmd",
         "args": ["/c", "npx", "-y", "github:fabienbutz/mcp-microsoft-todo"]
       }
   ```

3. **Restart Claude Desktop** — fully quit it (right-click the tray icon → **Quit** — closing the window isn't enough) and reopen.

4. **Test** — ask Claude *"list my Microsoft To Do lists"* or *"add a task"*. (15 tools: task lists, tasks, checklist items.)

> Running `login` (step 1) first matters: it warms the npx cache, so when Claude Desktop launches the server it starts in seconds instead of doing the slow first-time build. `npx` from a GitHub URL roughly follows the repo's latest commit; if you want a guaranteed-reliable update story (or to run offline), use Option B.

## Option B — build from source (local checkout)

Predictable, faster startup, easy to update with `git pull`.

1. **Get the code and build** — in PowerShell:
   ```powershell
   cd $HOME
   git clone https://github.com/fabienbutz/mcp-microsoft-todo.git
   cd mcp-microsoft-todo
   npm install
   npm run build
   ```
   This produces `dist\index.js`. Note the folder path — `pwd` prints it (e.g. `C:\Users\you\mcp-microsoft-todo`). *(Needs [Git](https://git-scm.com/download/win) for `git clone`; or download the ZIP from the repo's green **Code** button and extract it.)*

2. **Sign in once**:
   ```powershell
   node dist\index.js login
   ```
   (Same device-code flow as Option A step 1.)

3. **Configure Claude Desktop** — same config file as above, pointing at the built file:
   ```json
   {
     "mcpServers": {
       "microsoft-todo": {
         "command": "node",
         "args": ["C:/Users/you/mcp-microsoft-todo/dist/index.js"]
       }
     }
   }
   ```
   Replace the path with yours. **Use forward slashes (`/`)** — backslashes are escape characters in JSON. If `node` can't be found, use the full path to `node.exe` (`where.exe node` shows it, e.g. `C:/Program Files/nodejs/node.exe`).

4. **Restart Claude Desktop**, then test (as in Option A step 4).

> Update later: in the folder run `git pull`, then `npm install`, then `npm run build`, then restart Claude Desktop.

## Using your own Entra app

By default this uses Microsoft's well-known Graph CLI public client (no registration needed). To use your own app registration instead, see [`ENTRA-APP-SETUP.md`](ENTRA-APP-SETUP.md) and set `MS_TODO_CLIENT_ID` — in the config's `env` block (`"env": { "MS_TODO_CLIENT_ID": "<id>" }`) and as an env var when you run `login`.

## Troubleshooting

- **`node`/`npx` is not recognized** — Node isn't installed, or the terminal predates the install → reinstall Node (LTS), open a fresh terminal.
- **Claude Desktop shows the server as failed** — Option A: try the `cmd /c npx` form. Option B: check the path in the config (forward slashes? does `dist\index.js` exist?). Logs: `%APPDATA%\Claude\logs\mcp-server-microsoft-todo.log` (or `%LOCALAPPDATA%\Claude\logs\`).
- **First Claude Desktop launch times out (Option A)** — the cold `npx github:` run builds the package and can be slow → run `npx -y github:fabienbutz/mcp-microsoft-todo login` in a terminal first to warm the cache, then restart Claude Desktop.
