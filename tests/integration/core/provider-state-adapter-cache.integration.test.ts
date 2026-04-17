import test from 'node:test';
import assert from 'node:assert/strict';

import type { ProviderId } from '../../../src/core/provider-state-contract.ts';
import { createProviderStateAdapter } from '../../../src/core/provider-state-adapter.ts';
import { successResult } from '../../helpers/fake-shell-runner.ts';
import { createTempCacheDir } from '../../helpers/temp-cache-dir.ts';

const RAW_OPENAI = {
  providers: [
    { id: 'openai', name: 'OpenAI GPT-4', active: true },
  ],
  active_provider: 'openai',
};

const RAW_ANTHROPIC = {
  providers: [
    { id: 'openai', name: 'OpenAI GPT-4', active: false },
    { id: 'anthropic', name: 'Anthropic Claude', active: true },
  ],
  active_provider: 'anthropic',
};

function createFakeShell() {
  let activeProvider: ProviderId = 'openai';
  const calls: Array<{ args: string[] }> = [];

  return {
    run: async (_bin: string, args: string[], _timeout: number) => {
      calls.push({ args });
      const subcommand = args[1];
      if (subcommand === 'switch') {
        activeProvider = args[2];
        return successResult('');
      }
      if (subcommand === 'list') {
        const raw = activeProvider === 'anthropic' ? RAW_ANTHROPIC : RAW_OPENAI;
        return successResult(JSON.stringify(raw));
      }
      return successResult('');
    },
    calls,
    resetCalls: () => { calls.length = 0; },
  };
}

test('full adapter-cache lifecycle: miss → hit → invalidate → miss', async (t) => {
  const tmp = await createTempCacheDir();
  t.after(() => tmp.cleanup());

  const shell = createFakeShell();
  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    shellRunner: shell,
  });

  // Step 1: cache miss — CLI called
  const state1 = await adapter.getProviderState();
  assert.equal(state1.selectedProviderId, 'openai');
  assert.equal(shell.calls.filter(c => c.args[1] === 'list').length, 1);

  // Step 2: cache hit — no CLI call
  shell.resetCalls();
  const state2 = await adapter.getProviderState();
  assert.equal(state2.selectedProviderId, 'openai');
  assert.equal(shell.calls.filter(c => c.args[1] === 'list').length, 0);

  // Step 3: switch provider — invalidates cache
  shell.resetCalls();
  await adapter.setProvider('anthropic');
  assert.equal(shell.calls.filter(c => c.args[1] === 'switch').length, 1);

  // Step 4: post-switch — cache miss, CLI called again
  shell.resetCalls();
  const state3 = await adapter.getProviderState();
  assert.equal(state3.selectedProviderId, 'anthropic');
  assert.equal(shell.calls.filter(c => c.args[1] === 'list').length, 1);
});
