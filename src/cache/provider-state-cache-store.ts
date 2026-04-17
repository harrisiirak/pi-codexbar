import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProviderState } from '../core/provider-state-contract.ts';
import { isProviderStateCacheFresh } from '../config/provider-state-cache-policy.ts';

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

export function createProviderStateCacheStore(cacheFilePath: string) {
  return {
    async read(nowEpochMs: number): Promise<ProviderState | null> {
      let raw: string;
      try {
        raw = await readFile(cacheFilePath, 'utf-8');
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw err;
      }

      const parsed = safeParseCache(raw);
      if (!parsed || !isProviderStateCacheFresh(parsed.fetchedAtEpochMs, nowEpochMs)) {
        return null;
      }

      return parsed;
    },

    async write(state: ProviderState): Promise<void> {
      await mkdir(dirname(cacheFilePath), { recursive: true });
      await writeFile(cacheFilePath, JSON.stringify(state), 'utf-8');
    },

    async invalidate(): Promise<void> {
      try {
        await unlink(cacheFilePath);
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw err;
      }
    },
  };
}
