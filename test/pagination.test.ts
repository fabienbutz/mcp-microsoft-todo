import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { collectPages, decodeCursor, encodeCursor, type Page } from "../src/graph/pagination";

describe("pagination cursor", () => {
  it("round-trips arbitrary next-link strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decodeCursor(encodeCursor(s))).toBe(s);
      }),
    );
  });
});

describe("collectPages", () => {
  function splitIntoPages<T>(items: T[], pageSize: number): Page<T>[] {
    const pages: Page<T>[] = [];
    for (let i = 0; i < items.length; i += pageSize) {
      const hasNext = i + pageSize < items.length;
      pages.push({ value: items.slice(i, i + pageSize), ...(hasNext ? { "@odata.nextLink": `https://graph/p${i + pageSize}` } : {}) });
    }
    if (pages.length === 0) pages.push({ value: [] });
    return pages;
  }

  it("concatenates every item in order with no duplicates when the cap is high", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer(), { maxLength: 250 }), fc.integer({ min: 1, max: 40 }), async (items, pageSize) => {
        const pages = splitIntoPages(items, pageSize);
        let idx = 0;
        const result = await collectPages<number>(
          async () => pages[0]!,
          async () => pages[++idx]!,
          items.length + 1,
        );
        expect(result.items).toEqual(items);
        expect(result.hasMore).toBe(false);
        expect(result.cursor).toBeUndefined();
      }),
    );
  });

  it("stops at the soft cap (page-granular) and returns a resumable cursor", async () => {
    const pages: Page<number>[] = [
      { value: [1, 2, 3], "@odata.nextLink": "https://graph/p3" },
      { value: [4, 5, 6], "@odata.nextLink": "https://graph/p6" },
      { value: [7, 8] },
    ];
    let idx = 0;
    const result = await collectPages<number>(
      async () => pages[0]!,
      async (url) => {
        expect(url).toBe("https://graph/p3");
        return pages[++idx]!;
      },
      2,
    );
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe(encodeCursor("https://graph/p3"));
    expect(idx).toBe(0); // fetchNext never called: cap reached after the first page
  });

  it("resumes from a cursor", async () => {
    const pages: Record<string, Page<number>> = {
      "https://graph/p3": { value: [4, 5, 6] },
    };
    const result = await collectPages<number>(
      async () => {
        throw new Error("fetchFirst must not be called when a cursor is supplied");
      },
      async (url) => pages[url]!,
      100,
      encodeCursor("https://graph/p3"),
    );
    expect(result.items).toEqual([4, 5, 6]);
    expect(result.hasMore).toBe(false);
  });

  it("throws rather than looping forever on a non-terminating nextLink chain", async () => {
    const endless = async () => ({ value: [] as number[], "@odata.nextLink": "https://graph/loop" });
    await expect(collectPages<number>(endless, endless, 10)).rejects.toMatchObject({ code: "graph_error" });
  });
});
