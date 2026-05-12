import { z } from "zod";
import { DateTimeTimeZone, Importance, TaskStatus } from "../lib/schema";

/**
 * Schemas for the Microsoft To Do resources we touch. `.passthrough()` keeps forward-compat:
 * Graph may add fields, and that should not break us.
 */

export const TaskListSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    isOwner: z.boolean().optional(),
    isShared: z.boolean().optional(),
    wellknownListName: z.string().optional(),
  })
  .passthrough();
export type TaskList = z.infer<typeof TaskListSchema>;

export const ChecklistItemSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    isChecked: z.boolean().optional(),
    createdDateTime: z.string().optional(),
  })
  .passthrough();
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const TaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: TaskStatus.optional(),
    importance: Importance.optional(),
    isReminderOn: z.boolean().optional(),
    createdDateTime: z.string().optional(),
    lastModifiedDateTime: z.string().optional(),
    body: z.object({ content: z.string(), contentType: z.string() }).passthrough().optional(),
    dueDateTime: DateTimeTimeZone.optional(),
    reminderDateTime: DateTimeTimeZone.optional(),
    completedDateTime: DateTimeTimeZone.optional(),
    categories: z.array(z.string()).optional(),
    checklistItems: z.array(ChecklistItemSchema).optional(),
  })
  .passthrough();
export type Task = z.infer<typeof TaskSchema>;
