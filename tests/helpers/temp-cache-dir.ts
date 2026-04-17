/**
 * Test helper: create a temporary cache directory on the real filesystem,
 * automatically cleaned up after the test.
 */

import { mkdir, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface TempCacheDir {
  /** Absolute path to the cache file (e.g. /tmp/…/provider-state.json). */
  cacheFilePath: string;
  /** Read the cache file contents (throws ENOENT if missing). */
  readFile: (path: string) => Promise<string>;
  /** Write data to a file, creating parent directories as needed. */
  writeFile: (path: string, data: string) => Promise<void>;
  /** Remove a file (idempotent for ENOENT). */
  rmFile: (path: string) => Promise<void>;
  /** Create directories recursively. */
  mkdirp: (path: string) => Promise<void>;
  /** Extract directory portion of a path. */
  dirname: (path: string) => string;
  /** Remove the entire temp directory and its contents. */
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary cache directory for integration tests.
 * Call `cleanup()` in afterEach / after() to remove the directory.
 */
export async function createTempCacheDir(prefix = 'pi-codexbar-test-'): Promise<TempCacheDir> {
  const base = join(tmpdir(), `${prefix}${randomUUID()}`);
  const cacheFilePath = join(base, 'provider-state.json');

  // Pre-create the directory so the first write doesn't need mkdirp
  await mkdir(base, { recursive: true });

  return {
    cacheFilePath,
    readFile: (path: string) => readFile(path, 'utf-8'),
    writeFile: async (path: string, data: string) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, 'utf-8');
    },
    rmFile: async (path: string) => {
      try {
        await unlink(path);
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return; // idempotent
        }
        throw err;
      }
    },
    mkdirp: (path: string) => mkdir(path, { recursive: true }),
    dirname,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
