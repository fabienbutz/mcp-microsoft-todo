# Installing on Windows

`mcp-microsoft-todo` isn't published to npm yet, so on Windows you build it from source once (~10 minutes), then point Claude Desktop at the built file. Once it's on npm this collapses to the `npx` flow in the [README](../README.md#quick-start).

## Prerequisites

Install these if you don't already have them:

- **Node.js** ≥ 20 (LTS) — <https://nodejs.org> → the green **LTS** button → run the installer (defaults are fine). **Open a fresh terminal afterwards** so `node` is on your `PATH`.
- **Git** — <https://git-scm.com/download/win> (defaults are fine). *(Optional — see "Without Git" in step 1.)*

## 1. Get the code and build it

In PowerShell:

```powershell
cd $HOME
git clone https://github.com/fabienbutz/mcp-microsoft-todo.git
cd mcp-microsoft-todo
npm install
npm run build
```

**Without Git:** on the repo page, click the green **Code** button → **Download ZIP**, extract it to e.g. `C:\Users\<you>\mcp-microsoft-todo`, then in PowerShell `cd` into that folder and run `npm install` then `npm run build`.

This produces `dist\index.js`. Note the folder path — `pwd` prints it (e.g. `C:\Users\you\mcp-microsoft-todo`).

> If PowerShell refuses to run `npm` with an execution-policy error, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once (confirm with `Y`), or use Command Prompt (`cmd`) instead.

## 2. Sign in

```powershell
node dist\index.js login
```

It prints something like *"To sign in, use a web browser to open https://microsoft.com/devicelogin and enter the code ABCD-EFGH"*. Open that URL, sign in with your Microsoft account, enter the code, and approve the consent — it appears as **"Microsoft Graph Command Line Tools — Read and write your tasks"** (that's Microsoft's well-known tool client; the issued token is still limited to `Tasks.ReadWrite`). On success you'll see *"Signed in as …"*. The token is cached at `C:\Users\<you>\.config\mcp-microsoft-todo\token-cache.json` — you only do this once.

To use your own Entra app instead of the default client, see [`ENTRA-APP-SETUP.md`](ENTRA-APP-SETUP.md) and set `MS_TODO_CLIENT_ID` (in the `env` block of the config below, and as an env var when you run `login`).

## 3. Configure Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` — press <kbd>Win</kbd>+<kbd>R</kbd>, type `%APPDATA%\Claude`, press Enter, and open `claude_desktop_config.json` in a text editor (create the file/folder if it's missing). Add the `microsoft-todo` entry — **if there's already an `mcpServers` block, merge into it, don't replace it:**

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

- Replace the path with yours from step 1.
- **Use forward slashes (`/`)** in the path — backslashes are escape characters in JSON.
- If Claude Desktop reports `node` can't be found, replace `"node"` with the full path to `node.exe`, e.g. `"C:/Program Files/nodejs/node.exe"` (`where.exe node` shows it).

Save the file.

## 4. Restart Claude Desktop

Fully quit it (right-click the tray icon → **Quit** — closing the window isn't enough) and reopen. Config changes only take effect on a restart.

## 5. Test

Ask Claude: *"list my Microsoft To Do lists"* or *"add a task"*. You should see the `microsoft-todo` tools being used (15 of them — task lists, tasks, checklist items).

## Troubleshooting

- **`node is not recognized`** — Node isn't installed, or the terminal predates the install → reinstall Node (LTS) and open a fresh terminal.
- **Tools missing / Claude Desktop reports the server as failed** — almost always a path typo in the config. Check that `C:\Users\…\mcp-microsoft-todo\dist\index.js` actually exists, and that the JSON path uses forward slashes. If `node` can't be found, use the full path to `node.exe`.
- **Logs** — `%APPDATA%\Claude\logs\mcp-server-microsoft-todo.log` (or under `%LOCALAPPDATA%\Claude\logs\`).
- **Updating later** — `git pull` in the folder, then `npm install`, then `npm run build`, then restart Claude Desktop.
