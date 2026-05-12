import { z } from "zod";
import { defineTool, withIdempotency } from "./_shared";

export const checklistTools = [
  defineTool({
    name: "list_checklist_items",
    description: "List the checklist (sub-step) items of a task.",
    risk: "read",
    input: { listId: z.string(), taskId: z.string() },
    handler: (args, ctx) => ctx.tasks.listChecklist(args.listId, args.taskId, ctx.ids.uuid()),
  }),

  defineTool({
    name: "add_checklist_item",
    description: "Add a checklist item to a task.",
    risk: "write",
    input: { listId: z.string(), taskId: z.string(), displayName: z.string().min(1), isChecked: z.boolean().optional() },
    handler: (args, ctx) =>
      withIdempotency(ctx, "add_checklist_item", args, () =>
        ctx.tasks.addChecklistItem(args.listId, args.taskId, args.displayName, args.isChecked ?? false, ctx.ids.uuid()),
      ),
  }),

  defineTool({
    name: "update_checklist_item",
    description: "Update a checklist item (rename and/or check/uncheck).",
    risk: "write",
    input: {
      listId: z.string(),
      taskId: z.string(),
      itemId: z.string(),
      displayName: z.string().min(1).optional(),
      isChecked: z.boolean().optional(),
    },
    handler: (args, ctx) =>
      ctx.tasks.updateChecklistItem(args.listId, args.taskId, args.itemId, { displayName: args.displayName, isChecked: args.isChecked }, ctx.ids.uuid()),
  }),

  defineTool({
    name: "delete_checklist_item",
    description: "Delete a checklist item from a task. This cannot be undone.",
    risk: "destructive",
    input: { listId: z.string(), taskId: z.string(), itemId: z.string() },
    handler: async (args, ctx) => {
      await ctx.tasks.removeChecklistItem(args.listId, args.taskId, args.itemId, ctx.ids.uuid());
      return { deleted: true, itemId: args.itemId };
    },
  }),
];
