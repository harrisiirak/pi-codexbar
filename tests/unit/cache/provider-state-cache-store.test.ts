import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';

import type { ProviderState } from '../../../src/core/provider-state-contract.ts';
import { createProviderStateCacheStore } from '../../../src/cache/provider-state-cache-store.ts';

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

function tempCachePath(): string {
  return join(tmpdir(), `pi-test-${randomUUID()}`, 'provider-state.json');
}

test('read: miss (file does not exist) returns null', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const store = createProviderStateCacheStore(path);
  const result = await store.read(1_700_000_000_000);
  assert.equal(result, null);
});

test('read: hit (fresh, valid JSON) returns parsed state', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const state = sampleState();
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(state), 'utf-8');

  const store = createProviderStateCacheStore(path);
  const result = await store.read(state.fetchedAtEpochMs + 1);
  assert.deepEqual(result, state);
});

test('read: stale entry returns null', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const state = sampleState();
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(state), 'utf-8');

  const store = createProviderStateCacheStore(path);
  const result = await store.read(state.fetchedAtEpochMs + 15_000);
  assert.equal(result, null);
});

test('read: malformed cache JSON returns null (never throws)', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '{ not valid json !!!', 'utf-8');

  const store = createProviderStateCacheStore(path);
  const result = await store.read(1_700_000_000_000);
  assert.equal(result, null);
});

test('write: creates cache file with serialized state', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const store = createProviderStateCacheStore(path);
  const state = sampleState();
  await store.write(state);

  const written = await readFile(path, 'utf-8');
  assert.deepEqual(JSON.parse(written), state);
});

test('invalidate: removes cache file', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const state = sampleState();
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(state), 'utf-8');

  const store = createProviderStateCacheStore(path);
  await store.invalidate();

  const result = await store.read(1_700_000_000_000);
  assert.equal(result, null);
});

test('invalidate: idempotent when file does not exist', async (t) => {
  const path = tempCachePath();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));

  const store = createProviderStateCacheStore(path);
  await store.invalidate();
});
