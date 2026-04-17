import test from 'node:test';
import assert from 'node:assert/strict';

import type { ProviderState, ProviderStateAdapter, ProviderId } from '../../../src/core/provider-state-contract.ts';
import { createProviderStateAdapter, type CreateProviderStateAdapterDeps } from '../../../src/core/provider-state-adapter.ts';

// ── Shared fixtures ───────────────────────────────────────────────────

const FAKE_NOW = 1_710_000_000_000; // 2024-03-09ish

const SAMPLE_STATE: ProviderState = {
  providers: [
    { id: 'openai', label: 'OpenAI', enabled: true },
    { id: 'anthropic', label: 'Anthropic', enabled: false },
  ],
  selectedProviderId: 'openai',
  fetchedAtEpochMs: FAKE_NOW,
};

const RAW_LIST_OUTPUT = {
  providers: [
    { id: 'openai', name: 'OpenAI', active: true },
    { id: 'anthropic', name: 'Anthropic', active: false },
  ],
  active_provider: 'openai',
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<CreateProviderStateAdapterDeps> = {}): {
  deps: CreateProviderStateAdapterDeps;
  calls: {
    discoverBinary: number;
    runJson: Array<{ binaryPath: string; args: string[]; timeoutMs: number }>;
    normalize: number;
    cacheRead: number;
    cacheWrite: number;
    cacheInvalidate: number;
  };
} {
  const calls = {
    discoverBinary: 0,
    runJson: [] as Array<{ binaryPath: string; args: string[]; timeoutMs: number }>,
    normalize: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cacheInvalidate: 0,
  };

  const deps: CreateProviderStateAdapterDeps = {
    nowEpochMs: () => FAKE_NOW,
    discoverBinary: () => {
      calls.discoverBinary++;
      return '/usr/local/bin/codexbar';
    },
    runJson: async <T>(binaryPath: string, args: string[], timeoutMs: number): Promise<T> => {
      calls.runJson.push({ binaryPath, args, timeoutMs });
      return RAW_LIST_OUTPUT as unknown as T;
    },
    normalize: (raw: unknown, nowEpochMs: number) => {
      calls.normalize++;
      return SAMPLE_STATE;
    },
    cache: {
      read: async (_nowEpochMs: number) => {
        calls.cacheRead++;
        return null;
      },
      write: async (_state: ProviderState) => {
        calls.cacheWrite++;
      },
      invalidate: async () => {
        calls.cacheInvalidate++;
      },
    },
    listArgs: ['provider', 'list', '--json'],
    switchArgsForProvider: (providerId: ProviderId) => ['provider', 'switch', providerId],
    timeoutMs: 5000,
    ...overrides,
  };

  return { deps, calls };
}

// ── Module resolves at runtime ────────────────────────────────────────
test('provider-state-adapter module is importable at runtime', async () => {
  const mod = await import('../../../src/core/provider-state-adapter.ts');
  assert.ok(mod, 'module should resolve');
  assert.equal(typeof mod.createProviderStateAdapter, 'function');
});

// ── getProviderState: cache hit returns state without shell call ──────
test('getProviderState returns cached state on cache hit without calling discover or runJson', async () => {
  const { deps, calls } = makeDeps({
    cache: {
      read: async (_nowEpochMs: number) => {
        calls.cacheRead++;
        return SAMPLE_STATE;
      },
      write: async (_state: ProviderState) => {
        calls.cacheWrite++;
      },
      invalidate: async () => {
        calls.cacheInvalidate++;
      },
    },
  });

  const adapter = createProviderStateAdapter(deps);
  const result = await adapter.getProviderState();

  assert.deepEqual(result, SAMPLE_STATE);
  assert.equal(calls.cacheRead, 1, 'should read cache once');
  assert.equal(calls.discoverBinary, 0, 'should NOT call discoverBinary on cache hit');
  assert.equal(calls.runJson.length, 0, 'should NOT call runJson on cache hit');
  assert.equal(calls.normalize, 0, 'should NOT call normalize on cache hit');
  assert.equal(calls.cacheWrite, 0, 'should NOT write cache on cache hit');
});

// ── getProviderState: cache miss triggers discover + runJson + normalize + cache write ──
test('getProviderState on cache miss triggers discover + list + normalize + cache write', async () => {
  const { deps, calls } = makeDeps();

  const adapter = createProviderStateAdapter(deps);
  const result = await adapter.getProviderState();

  assert.deepEqual(result, SAMPLE_STATE);
  assert.equal(calls.cacheRead, 1, 'should read cache once');
  assert.equal(calls.discoverBinary, 1, 'should call discoverBinary once');
  assert.equal(calls.runJson.length, 1, 'should call runJson once');
  assert.deepEqual(calls.runJson[0]!.args, ['provider', 'list', '--json'], 'should pass listArgs');
  assert.equal(calls.normalize, 1, 'should call normalize once');
  assert.equal(calls.cacheWrite, 1, 'should write cache once');
});

// ── setProvider: executes switch command then invalidates cache ───────
test('setProvider executes switch command then invalidates cache', async () => {
  const { deps, calls } = makeDeps();

  const adapter = createProviderStateAdapter(deps);
  await adapter.setProvider('anthropic');

  assert.equal(calls.discoverBinary, 1, 'should call discoverBinary once');
  assert.equal(calls.runJson.length, 1, 'should call runJson once for switch');
  assert.deepEqual(calls.runJson[0]!.args, ['provider', 'switch', 'anthropic'], 'should pass switch args');
  assert.equal(calls.cacheInvalidate, 1, 'should invalidate cache once after switch');
});

// ── setProvider: switch failure does not silently pass ────────────────
test('setProvider throws on switch failure and does not invalidate cache', async () => {
  const { deps, calls } = makeDeps({
    runJson: async <T>(_binaryPath: string, _args: string[], _timeoutMs: number): Promise<T> => {
      calls.runJson.push({ binaryPath: _binaryPath, args: _args, timeoutMs: _timeoutMs });
      throw new Error('codexbar command failed: non-zero-exit');
    },
  });

  const adapter = createProviderStateAdapter(deps);

  await assert.rejects(
    () => adapter.setProvider('anthropic'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('non-zero-exit'));
      return true;
    },
  );

  assert.equal(calls.cacheInvalidate, 0, 'should NOT invalidate cache on switch failure');
});

// ── setProvider: cache invalidation occurs exactly once after success ─
test('setProvider invalidates cache exactly once after successful switch', async () => {
  let invalidateCount = 0;
  const { deps } = makeDeps({
    cache: {
      read: async () => null,
      write: async () => {},
      invalidate: async () => {
        invalidateCount++;
      },
    },
  });

  const adapter = createProviderStateAdapter(deps);
  await adapter.setProvider('anthropic');

  assert.equal(invalidateCount, 1, 'cache should be invalidated exactly once');
});
