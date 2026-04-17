import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { createProviderStateAdapter } from '../../../src/core/provider-state-adapter.ts';
import { successResult } from '../../helpers/fake-shell-runner.ts';
import { createTempCacheDir } from '../../helpers/temp-cache-dir.ts';

const RAW_OPENAI = {
  providers: [
    { id: 'openai', name: 'OpenAI', active: true },
    { id: 'anthropic', name: 'Anthropic', active: false },
  ],
  active_provider: 'openai',
};

test('provider-state-adapter module is importable at runtime', async () => {
  const mod = await import('../../../src/core/provider-state-adapter.ts');
  assert.equal(typeof mod.createProviderStateAdapter, 'function');
});

test('getProviderState fetches from CLI on cache miss', async (t) => {
  const tmp = await createTempCacheDir();
  t.after(() => tmp.cleanup());

  const runCalls: string[][] = [];
  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: {
      run: async (_bin, args, _timeout) => {
        runCalls.push(args);
        return successResult(JSON.stringify(RAW_OPENAI));
      },
    },
  });

  const state = await adapter.getProviderState();
  assert.equal(state.selectedProviderId, 'openai');
  assert.equal(runCalls.length, 1);
});

test('getProviderState returns cached state on second call within TTL', async (t) => {
  const tmp = await createTempCacheDir();
  t.after(() => tmp.cleanup());

  let runCount = 0;
  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: {
      run: async () => {
        runCount++;
        return successResult(JSON.stringify(RAW_OPENAI));
      },
    },
  });

  await adapter.getProviderState();
  await adapter.getProviderState();
  assert.equal(runCount, 1, 'should only call CLI once, second call uses cache');
});

test('setProvider executes switch command then invalidates cache', async (t) => {
  const tmp = await createTempCacheDir();
  t.after(() => tmp.cleanup());

  const runCalls: string[][] = [];
  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: {
      run: async (_bin, args, _timeout) => {
        runCalls.push(args);
        return successResult(JSON.stringify(RAW_OPENAI));
      },
    },
  });

  // Prime cache
  await adapter.getProviderState();
  runCalls.length = 0;

  // Switch
  await adapter.setProvider('anthropic');
  assert.equal(runCalls.length, 1);
  assert.deepEqual(runCalls[0], ['provider', 'switch', 'anthropic']);
});

test('setProvider throws on CLI failure and does not invalidate cache', async (t) => {
  const tmp = await createTempCacheDir();
  t.after(() => tmp.cleanup());

  let firstCall = true;
  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: {
      run: async (_bin, args, _timeout) => {
        if (!firstCall) {
          return { exitCode: 1, stdout: '', stderr: 'connection refused', timedOut: false };
        }
        firstCall = false;
        return successResult(JSON.stringify(RAW_OPENAI));
      },
    },
  });

  // Prime cache
  await adapter.getProviderState();

  // Switch should fail
  await assert.rejects(() => adapter.setProvider('anthropic'));

  // Cache should still be valid (not invalidated)
  let runCount = 0;
  const adapter2 = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: {
      run: async () => {
        runCount++;
        return successResult(JSON.stringify(RAW_OPENAI));
      },
    },
  });
  await adapter2.getProviderState();
  assert.equal(runCount, 0, 'cache should still be valid after failed switch');
});
