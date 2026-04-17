import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { ProviderState } from '../../../src/core/provider-state-contract.ts';
import { createProviderStateCacheStore } from '../../../src/cache/provider-state-cache-store.ts';

// ── Fake filesystem helpers ────────────────────────────────────────────

/**
 * In-memory fake filesystem for testing the cache store in isolation.
 * Models a single-directory filesystem where only the cacheFilePath exists.
 */
function createFakeFs(initialFiles: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initialFiles));

  return {
    readFile: (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return Promise.resolve(content);
    },
    writeFile: (path: string, data: string) => {
      files.set(path, data);
      return Promise.resolve();
    },
    rmFile: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
    mkdirp: (_path: string) => Promise.resolve(),
    dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
    /** Test-only: inspect the in-memory filesystem. */
    getFiles: () => Object.fromEntries(files),
  };
}

/** Build a sample ProviderState for reuse in tests. */
function sampleState(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    providers: [
      { id: 'openai', label: 'OpenAI', enabled: true },
      { id: 'anthropic', label: 'Anthropic', enabled: true },
    ],
    selectedProviderId: 'openai',
    fetchedAtEpochMs: 1_700_000_000_000,
    ...overrides,
  };
}

/** Simple isFresh: fresh when (now - cachedAt) < 15_000. */
function defaultIsFresh(cachedAtEpochMs: number, nowEpochMs: number): boolean {
  return nowEpochMs - cachedAtEpochMs < 15_000;
}

const CACHE_FILE = join('/tmp', '.pi-cache', 'provider-state.json');

// ── read ───────────────────────────────────────────────────────────────

test('read: miss (file does not exist) returns null', async () => {
  const fs = createFakeFs(); // empty
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  const result = await store.read(1_700_000_000_000);
  assert.equal(result, null);
});

test('read: hit (fresh, valid JSON) returns parsed state', async () => {
  const state = sampleState();
  const fs = createFakeFs({
    [CACHE_FILE]: JSON.stringify(state),
  });
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  const result = await store.read(state.fetchedAtEpochMs + 1);
  assert.deepEqual(result, state);
});

test('read: stale entry (isFresh returns false) returns null', async () => {
  const state = sampleState();
  const fs = createFakeFs({
    [CACHE_FILE]: JSON.stringify(state),
  });
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  const result = await store.read(state.fetchedAtEpochMs + 15_000);
  assert.equal(result, null);
});

test('read: malformed cache JSON returns null (never throws)', async () => {
  const fs = createFakeFs({
    [CACHE_FILE]: '{ not valid json !!!',
  });
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  const result = await store.read(1_700_000_000_000);
  assert.equal(result, null);
});

// ── write ───────────────────────────────────────────────────────────────

test('write: creates cache file with serialized state', async () => {
  const fs = createFakeFs();
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  const state = sampleState();
  await store.write(state);

  const written = fs.getFiles()[CACHE_FILE];
  assert.ok(written, 'cache file should be written');
  assert.deepEqual(JSON.parse(written), state);
});

// ── invalidate ─────────────────────────────────────────────────────────

test('invalidate: removes cache file', async () => {
  const state = sampleState();
  const fs = createFakeFs({
    [CACHE_FILE]: JSON.stringify(state),
  });
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  await store.invalidate();
  assert.equal(CACHE_FILE in fs.getFiles(), false, 'cache file should be deleted');
});

test('invalidate: idempotent when file does not exist', async () => {
  const fs = createFakeFs(); // empty
  const store = createProviderStateCacheStore({
    cacheFilePath: CACHE_FILE,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rmFile: fs.rmFile,
    mkdirp: fs.mkdirp,
    dirname: fs.dirname,
    isFresh: defaultIsFresh,
  });

  // Must NOT throw
  await store.invalidate();
});
