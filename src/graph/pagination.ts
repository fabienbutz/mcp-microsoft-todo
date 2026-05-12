import { AppError } from "./errors";

/** OData collection response. */
export interface Page<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
  /** Opaque cursor (base64url of the next `@odata.nextLink`); pass it back to continue. */
  cursor?: string;
}

export function encodeCursor(nextLink: string): string {
  return Buffer.from(nextLink, "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf-8");
}

/** Safety bound against a pathological / non-terminating `@odata.nextLink` chain. */
const MAX_PAGES = 1000;

/**
 * Follow `@odata.nextLink` until we have at least `softCap` items (page-granular — we never
 * split a page, so the result may slightly exceed the cap) or run out of pages. If stopped
 * by the cap with more to come, returns a resumable cursor.
 */
export async function collectPages<T>(
  fetchFirst: () => Promise<Page<T>>,
  fetchNext: (absoluteUrl: string) => Promise<Page<T>>,
  softCap: number,
  startCursor?: string,
): Promise<PagedResult<T>> {
  const items: T[] = [];
  let page: Page<T> = startCursor ? await fetchNext(decodeCursor(startCursor)) : await fetchFirst();

  for (let pages = 1; ; pages++) {
    items.push(...page.value);
    const next = page["@odata.nextLink"];
    if (!next) return { items, hasMore: false };
    if (items.length >= softCap) return { items, hasMore: true, cursor: encodeCursor(next) };
    if (pages >= MAX_PAGES) throw new AppError("graph_error", `Pagination did not terminate after ${MAX_PAGES} pages.`);
    page = await fetchNext(next);
  }
}
