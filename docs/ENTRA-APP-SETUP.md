# Using your own Microsoft Entra app (optional)

> **You don't need this.** By default `mcp-microsoft-todo` uses the well-known *Microsoft Graph CLI* public client id, so it works with no registration. Follow this only if you want the app to appear under your own name on the Microsoft consent screen / in audit logs — e.g. for a workplace deployment.

To register your own app you need *a* Microsoft account with access to an Entra tenant. A **personal** Microsoft account works: signing in to <https://portal.azure.com> with it provisions a free directory automatically — no Azure subscription or credit card. App registrations are free.

## Steps

1. Go to <https://portal.azure.com>, sign in, and search **"App registrations"** in the top bar — or open it directly: <https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade>. Click **+ New registration**. (The Microsoft Entra admin center at <https://entra.microsoft.com> has the same thing under *Applications → App registrations*, but its left-nav layout changes often — the Azure-portal search box is more stable.)

2. **Name:** anything, e.g. `mcp-microsoft-todo`.

3. **Supported account types:** pick **"Accounts in any organizational directory and personal Microsoft accounts"** for the widest reach. (If you only ever use one work tenant and want to lock it down, pick single-tenant — then later set `MS_TODO_AUTHORITY=https://login.microsoftonline.com/<your-tenant-id>`.)

4. **Redirect URI:** leave it **blank**. The device-code flow doesn't use one.

5. Click **Register**.

6. On the app's **Overview** page, copy the **Application (client) ID** — this is your `MS_TODO_CLIENT_ID`. (A public-client ID is not a secret; it's fine to put in config or even commit.)

7. Go to **Authentication** → scroll to **Advanced settings** → set **"Allow public client flows"** to **Yes** → **Save**. (Device-code is a public-client flow; without this, login fails.)

8. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions** → search **`Tasks`** → check **`Tasks.ReadWrite`** (and `Tasks.ReadWrite.Shared` too if you want shared lists) → **Add permissions**. `offline_access` (for the refresh token) is requested automatically; you don't need to add it.

9. **Admin consent:** for personal accounts and `Tasks.ReadWrite` on most tenants you'll just consent yourself on first login — nothing to do here. If your organization restricts user consent, an admin needs to click **"Grant admin consent for <tenant>"** on the API permissions page.

## Use it

Set the client ID wherever your MCP client passes env vars (see the README's quick-start), then run the one-time login:

```bash
MS_TODO_CLIENT_ID=<your-application-client-id> npx -y mcp-microsoft-todo login
```

If you registered a **single-tenant** app, also set:

```bash
MS_TODO_AUTHORITY=https://login.microsoftonline.com/<your-tenant-id>
```

## Removing access

- Server side: `npx mcp-microsoft-todo logout` (deletes the local token cache).
- Account side: revoke the app at <https://myapps.microsoft.com> (work/school) or <https://account.live.com/consent/Manage> (personal). Deleting the app registration also invalidates everything.
