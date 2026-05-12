import { collectPages, type Page } from "../graph/pagination";
import type { GraphClient } from "../graph/client";
import { toGraphDateTime, type DateTimeInput, type Importance, type TaskStatus } from "../lib/schema";
import { ChecklistItemSchema, TaskSchema, type ChecklistItem, type Task } from "./types";

const PAGE_SIZE = 100;

export interface CreateTaskInput {
  listId: string;
  title: string;
  body?: string;
  dueDateTime?: DateTimeInput;
  reminderDateTime?: DateTimeInput;
  importance?: Importance;
  status?: TaskStatus;
  categories?: string[];
}

export interface UpdateTaskFields {
  title?: string;
  body?: string;
  dueDateTime?: DateTimeInput | null;
  reminderDateTime?: DateTimeInput | null;
  importance?: Importance;
  status?: TaskStatus;
  categories?: string[];
}

export interface ListTasksOptions {
  status?: "all" | "notStarted" | "inProgress" | "completed";
  includeChecklist?: boolean;
  includeLinkedResources?: boolean;
  cursor?: string;
  maxResults?: number;
  traceId?: string;
}

export class TasksApi {
  constructor(private readonly graph: GraphClient, private readonly defaultMaxResults: number) {}

  async list(listId: string, opts: ListTasksOptions = {}): Promise<{ items: Task[]; hasMore: boolean; cursor?: string }> {
    const cap = opts.maxResults ?? this.defaultMaxResults;
    const query: Record<string, string | number> = { $top: PAGE_SIZE };
    const expand = expandParam(opts);
    if (expand) query.$expand = expand;
    if (opts.status && opts.status !== "all") query.$filter = `status eq '${opts.status}'`;

    const base = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
    const result = await collectPages<unknown>(
      () => this.graph.request<Page<unknown>>("GET", base, { query, traceId: opts.traceId }),
      (url) => this.graph.request<Page<unknown>>("GET", url, { traceId: opts.traceId }),
      cap,
      opts.cursor,
    );
    return { items: result.items.map((x) => TaskSchema.parse(x)), hasMore: result.hasMore, cursor: result.cursor };
  }

  async get(listId: string, taskId: string, opts: { includeChecklist?: boolean; includeLinkedResources?: boolean; traceId?: string } = {}): Promise<Task> {
    const expand = expandParam(opts);
    return TaskSchema.parse(
      await this.graph.request<unknown>("GET", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
        query: expand ? { $expand: expand } : undefined,
        traceId: opts.traceId,
      }),
    );
  }

  async create(input: CreateTaskInput, traceId?: string): Promise<Task> {
    return TaskSchema.parse(
      await this.graph.request<unknown>("POST", `/me/todo/lists/${encodeURIComponent(input.listId)}/tasks`, { body: taskPayload(input), traceId }),
    );
  }

  async update(listId: string, taskId: string, fields: UpdateTaskFields, traceId?: string): Promise<Task> {
    return TaskSchema.parse(
      await this.graph.request<unknown>("PATCH", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
        body: taskPayload(fields),
        traceId,
      }),
    );
  }

  complete(listId: string, taskId: string, traceId?: string): Promise<Task> {
    return this.update(listId, taskId, { status: "completed" }, traceId);
  }

  async remove(listId: string, taskId: string, traceId?: string): Promise<void> {
    await this.graph.request<void>("DELETE", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { traceId });
  }

  async listChecklist(listId: string, taskId: string, traceId?: string): Promise<ChecklistItem[]> {
    const res = await this.graph.request<Page<unknown>>(
      "GET",
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems`,
      { traceId },
    );
    return res.value.map((x) => ChecklistItemSchema.parse(x));
  }

  async addChecklistItem(listId: string, taskId: string, displayName: string, isChecked: boolean, traceId?: string): Promise<ChecklistItem> {
    return ChecklistItemSchema.parse(
      await this.graph.request<unknown>("POST", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems`, {
        body: { displayName, isChecked },
        traceId,
      }),
    );
  }

  async updateChecklistItem(
    listId: string,
    taskId: string,
    itemId: string,
    patch: { displayName?: string; isChecked?: boolean },
    traceId?: string,
  ): Promise<ChecklistItem> {
    return ChecklistItemSchema.parse(
      await this.graph.request<unknown>(
        "PATCH",
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems/${encodeURIComponent(itemId)}`,
        { body: patch, traceId },
      ),
    );
  }

  async removeChecklistItem(listId: string, taskId: string, itemId: string, traceId?: string): Promise<void> {
    await this.graph.request<void>(
      "DELETE",
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems/${encodeURIComponent(itemId)}`,
      { traceId },
    );
  }
}

function expandParam(opts: { includeChecklist?: boolean; includeLinkedResources?: boolean }): string {
  return [opts.includeChecklist ? "checklistItems" : null, opts.includeLinkedResources ? "linkedResources" : null].filter(Boolean).join(",");
}

/** Build the Graph request body from create/update input — only touches keys that were provided. */
function taskPayload(input: CreateTaskInput | UpdateTaskFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("title" in input && input.title !== undefined) out.title = input.title;
  if (input.body !== undefined) out.body = { content: input.body, contentType: "text" };
  if (input.importance !== undefined) out.importance = input.importance;
  if (input.status !== undefined) out.status = input.status;
  if (input.categories !== undefined) out.categories = input.categories;
  if (input.dueDateTime !== undefined) out.dueDateTime = input.dueDateTime === null ? null : toGraphDateTime(input.dueDateTime);
  if (input.reminderDateTime !== undefined) {
    out.reminderDateTime = input.reminderDateTime === null ? null : toGraphDateTime(input.reminderDateTime);
    out.isReminderOn = input.reminderDateTime !== null;
  }
  return out;
}
