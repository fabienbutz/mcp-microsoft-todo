import { z } from "zod";
import { defineTool, withIdempotency } from "./_shared";

export const listTools = [
  defineTool({
    name: "list_task_lists",
    description: "List all Microsoft To Do task lists for the signed-in user.",
    risk: "read",
    input: {
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous call"),
      maxResults: z.number().int().min(1).max(1000).optional().describe("Soft cap on items (page-granular)"),
    },
    handler: (args, ctx) => ctx.lists.list({ cursor: args.cursor, maxResults: args.maxResults, traceId: ctx.ids.uuid() }),
  }),

  defineTool({
    name: "create_task_list",
    description: "Create a new To Do task list.",
    risk: "write",
    input: { displayName: z.string().min(1).describe("Name of the new list") },
    handler: (args, ctx) => withIdempotency(ctx, "create_task_list", args, () => ctx.lists.create(args.displayName, ctx.ids.uuid())),
  }),

  defineTool({
    name: "update_task_list",
    description: "Rename a To Do task list.",
    risk: "write",
    input: { listId: z.string(), displayName: z.string().min(1) },
    handler: (args, ctx) => ctx.lists.update(args.listId, args.displayName, ctx.ids.uuid()),
  }),

  defineTool({
    name: "delete_task_list",
    description: "Permanently delete a To Do task list AND all tasks inside it. This cannot be undone.",
    risk: "destructive",
    input: { listId: z.string() },
    handler: async (args, ctx) => {
      await ctx.lists.remove(args.listId, ctx.ids.uuid());
      return { deleted: true, listId: args.listId };
    },
  }),
];
