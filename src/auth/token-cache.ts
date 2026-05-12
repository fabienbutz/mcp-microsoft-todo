import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";

/**
 * Persists the MSAL token cache (which holds the refresh token) to a file with `0600`
 * permissions. Treat that file like an SSH private key. A missing file is normal (not yet
 * signed in); a corrupt file is tolerated — we start with an empty cache and the next
 * successful login overwrites it.
 */
export function fileCachePlugin(path: string): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      let data: string;
      try {
        data = await readFile(path, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      try {
        ctx.tokenCache.deserialize(data);
      } catch {
        // Corrupt cache — ignore it and start fresh rather than crashing.
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, ctx.tokenCache.serialize(), { mode: 0o600 });
    },
  };
}

export async function clearCache(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
