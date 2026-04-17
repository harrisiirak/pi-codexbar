import type { ProviderState } from '../core/provider-state-contract.ts';

export interface ProviderStateCacheStore {
  read(nowEpochMs: number): Promise<ProviderState | null>;
  write(state: ProviderState): Promise<void>;
  invalidate(): Promise<void>;
}

/**
 * Safely parse a raw JSON string into a ProviderState, returning `null`
 * for any malformed, invalid, or structurally unexpected content.
 */
function safeParseCache(raw: string): ProviderState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('fetchedAtEpochMs' in parsed) ||
    typeof (parsed as Record<string, unknown>).fetchedAtEpochMs !== 'number'
  ) {
    return null;
  }

  return parsed as ProviderState;
}

export function createProviderStateCacheStore(deps: {
  cacheFilePath: string;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  rmFile: (path: string) => Promise<void>;
  mkdirp: (path: string) => Promise<void>;
  dirname: (path: string) => string;
  isFresh: (cachedAtEpochMs: number, nowEpochMs: number) => boolean;
}): ProviderStateCacheStore {
  const { cacheFilePath, readFile, writeFile, rmFile, mkdirp, dirname, isFresh } = deps;

  return {
    async read(nowEpochMs: number): Promise<ProviderState | null> {
      let raw: string;
      try {
        raw = await readFile(cacheFilePath);
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw err;
      }

      const parsed = safeParseCache(raw);
      if (parsed === null) {
        return null;
      }

      if (!isFresh(parsed.fetchedAtEpochMs, nowEpochMs)) {
        return null;
      }

      return parsed;
    },

    async write(state: ProviderState): Promise<void> {
      const dir = dirname(cacheFilePath);
      await mkdirp(dir);
      await writeFile(cacheFilePath, JSON.stringify(state));
    },

    async invalidate(): Promise<void> {
      try {
        await rmFile(cacheFilePath);
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return; // idempotent: file already gone
        }
        throw err;
      }
    },
  };
}
