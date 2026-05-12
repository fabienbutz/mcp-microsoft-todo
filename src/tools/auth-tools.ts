import { defineTool } from "./_shared";

export const authTools = [
  defineTool({
    name: "auth_status",
    description: "Show the current Microsoft sign-in state for this server — account, token expiry, and any pending device-code sign-in. Read-only; makes no Graph call.",
    risk: "read",
    input: {},
    handler: async (_args, ctx) => ctx.auth.status(),
  }),

  defineTool({
    name: "sign_in",
    description:
      "Start signing in to Microsoft To Do via the device-code flow. Returns a short code and a URL — tell the user to open the URL in a browser, enter the code, and approve the consent; then have them ask you to continue (or call auth_status, or just retry the original action). The sign-in completes in the background. If already signed in, reports that instead. (You don't strictly need to call this — any tool that needs a token will start the same flow and return the code in its error.)",
    risk: "read",
    input: {},
    handler: async (_args, ctx) => {
      const status = ctx.auth.status();
      if (status.state === "authenticated" || ctx.auth.hasAccount()) {
        return {
          state: "already_signed_in",
          account: status.account,
          hint: "Already signed in. To switch accounts, sign out first (`microsoft-todo-mcp logout`), then sign in again.",
        };
      }
      const code = await ctx.auth.signIn();
      return {
        action: "device_code",
        verificationUri: code.verificationUri,
        userCode: code.userCode,
        expiresInSeconds: code.expiresInSeconds,
        message: `Open ${code.verificationUri} in a browser, enter the code ${code.userCode}, and approve the consent ("Microsoft Graph Command Line Tools"). The code expires in about ${Math.max(1, Math.round(code.expiresInSeconds / 60))} minutes. Once you've done that, ask me to continue.`,
      };
    },
  }),
];
