import { collectPages, type Page } from "../graph/pagination";
import type { GraphClient } from "../graph/client";
import { TaskListSchema, type TaskList } from "./types";

const PAGE_SIZE = 100;

export class TaskListsApi {
  constructor(private readonly graph: GraphClient, private readonly defaultMaxResults: number) {}

  async list(opts: { cursor?: string; maxResults?: number; traceId?: string } = {}): Promise<{ items: TaskList[]; hasMore: boolean; cursor?: string }> {
    const cap = opts.maxResults ?? this.defaultMaxResults;
    const result = await collectPages<unknown>(
      () => this.graph.request<Page<unknown>>("GET", "/me/todo/lists", { query: { $top: PAGE_SIZE }, traceId: opts.traceId }),
      (url) => this.graph.request<Page<unknown>>("GET", url, { traceId: opts.traceId }),
      cap,
      opts.cursor,
    );
    return { items: result.items.map((x) => TaskListSchema.parse(x)), hasMore: result.hasMore, cursor: result.cursor };
  }

  async create(displayName: string, traceId?: string): Promise<TaskList> {
    return TaskListSchema.parse(await this.graph.request<unknown>("POST", "/me/todo/lists", { body: { displayName }, traceId }));
  }

  async update(listId: string, displayName: string, traceId?: string): Promise<TaskList> {
    return TaskListSchema.parse(
      await this.graph.request<unknown>("PATCH", `/me/todo/lists/${encodeURIComponent(listId)}`, { body: { displayName }, traceId }),
    );
  }

  async remove(listId: string, traceId?: string): Promise<void> {
    await this.graph.request<void>("DELETE", `/me/todo/lists/${encodeURIComponent(listId)}`, { traceId });
  }
}
