import { defineTool } from "./_shared";

export const authTools = [
  defineTool({
    name: "auth_status",
    description: "Show the current Microsoft sign-in state for this server (account, token expiry). Read-only; makes no Graph call.",
    risk: "read",
    input: {},
    handler: async (_args, ctx) => ctx.auth.status(),
  }),
];
