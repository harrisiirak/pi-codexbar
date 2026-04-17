/**
 * Integration test: full adapter → cache → filesystem lifecycle.
 *
 * Uses real filesystem (temp dir) for cache and real production modules,
 * but fakes the shell runner so no real codexbar binary is required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { ProviderId, ProviderState } from '../../../src/core/provider-state-contract.ts';
import { createProviderStateAdapter } from '../../../src/core/provider-state-adapter.ts';
import { normalizeProviderState } from '../../../src/core/provider-state-normalizer.ts';
import { createProviderStateCacheStore } from '../../../src/cache/provider-state-cache-store.ts';
import { isProviderStateCacheFresh } from '../../../src/config/provider-state-cache-policy.ts';
import { successResult } from '../../helpers/fake-shell-runner.ts';
import { createTempCacheDir, type TempCacheDir } from '../../helpers/temp-cache-dir.ts';

// ── Raw CLI fixtures ───────────────────────────────────────────────────

const RAW_PROVIDERS_OPENAI = {
  providers: [
    { id: 'openai', name: 'OpenAI GPT-4', active: true },
  ],
  active_provider: 'openai',
};

const RAW_PROVIDERS_ANTHROPIC = {
  providers: [
    { id: 'openai', name: 'OpenAI GPT-4', active: false },
    { id: 'anthropic', name: 'Anthropic Claude', active: true },
  ],
  active_provider: 'anthropic',
};

// ── Clock helper ───────────────────────────────────────────────────────

function makeClock(startMs: number) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

// ── Fake shell with switch state tracking ──────────────────────────────

/**
 * Build a fake shell runner that simulates codexbar CLI responses.
 * Before any switch: `provider list --json` returns openai as active.
 * After a switch to a provider: `provider list --json` returns that provider as active.
 */
function createFakeShell() {
  let activeProvider: ProviderId = 'openai';
  const calls: Array<{ binary: string; args: string[] }> = [];

  function run(binaryPath: string, args: string[], _timeoutMs: number) {
    calls.push({ binary: binaryPath, args });

    const subcommand = args[1]; // 'list' or 'switch'

    if (subcommand === 'switch') {
      activeProvider = args[2];
      return Promise.resolve(successResult(''));
    }

    if (subcommand === 'list') {
      const raw = activeProvider === 'anthropic' ? RAW_PROVIDERS_ANTHROPIC : RAW_PROVIDERS_OPENAI;
      return Promise.resolve(successResult(JSON.stringify(raw)));
    }

    return Promise.resolve(successResult(''));
  }

  return {
    run,
    calls,
    /** Reset call log (keeps activeProvider state). */
    resetCalls: () => { calls.length = 0; },
  };
}

// ── Shared integration wiring ──────────────────────────────────────────

interface IntegrationHarness {
  clock: ReturnType<typeof makeClock>;
  shell: ReturnType<typeof createFakeShell>;
  tempDir: TempCacheDir;
  getProviderState: () => Promise<ProviderState>;
  setProvider: (id: ProviderId) => Promise<void>;
}

async function createIntegrationHarness(startMs: number): Promise<IntegrationHarness> {
  const clock = makeClock(startMs);
  const tempDir = await createTempCacheDir();
  const shell = createFakeShell();

  const cacheStore = createProviderStateCacheStore({
    cacheFilePath: tempDir.cacheFilePath,
    readFile: tempDir.readFile,
    writeFile: tempDir.writeFile,
    rmFile: tempDir.rmFile,
    mkdirp: tempDir.mkdirp,
    dirname: tempDir.dirname,
    isFresh: isProviderStateCacheFresh,
  });

  const adapter = createProviderStateAdapter({
    nowEpochMs: clock.now,
    discoverBinary: () => '/usr/local/bin/codexbar',
    runJson: async (binaryPath, args, timeoutMs) => {
      const result = await shell.run(binaryPath, args, timeoutMs);
      return JSON.parse(result.stdout || 'null');
    },
    normalize: normalizeProviderState,
    cache: cacheStore,
    listArgs: ['provider', 'list', '--json'],
    switchArgsForProvider: (id: ProviderId) => ['provider', 'switch', id],
    timeoutMs: 5000,
  });

  return {
    clock,
    shell,
    tempDir,
    getProviderState: () => adapter.getProviderState(),
    setProvider: (id) => adapter.setProvider(id),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test('full adapter–cache lifecycle: miss → hit → invalidate → miss', async (t) => {
  const harness = await createIntegrationHarness(1_700_000_000_000);
  t.after(() => harness.tempDir.cleanup());

  // ── Step 1: First read — cache miss, command executes ─────────────
  const state1 = await harness.getProviderState();

  assert.equal(state1.selectedProviderId, 'openai', 'first read should return openai as selected');
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    1,
    'first read should execute list command exactly once',
  );

  // ── Step 2: Second read within TTL — cache hit, no command ────────
  harness.clock.advance(5_000); // well within 15s TTL
  harness.shell.resetCalls();

  const state2 = await harness.getProviderState();

  assert.equal(state2.selectedProviderId, 'openai', 'cached read should still return openai');
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    0,
    'second read within TTL should NOT execute list command',
  );

  // ── Step 3: Switch provider — invalidates cache ───────────────────
  harness.shell.resetCalls();
  await harness.setProvider('anthropic');

  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'switch').length,
    1,
    'switch should execute switch command',
  );

  // ── Step 4: Post-switch read — cache miss, command executes ────────
  harness.clock.advance(1_000); // small advance, still well within TTL range
  harness.shell.resetCalls();

  const state3 = await harness.getProviderState();

  assert.equal(
    state3.selectedProviderId,
    'anthropic',
    'post-switch read should return anthropic as selected',
  );
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    1,
    'post-switch read should execute list command (cache was invalidated)',
  );
});

test('cache expires after TTL: fresh hit → stale miss → fresh refetch', async (t) => {
  const harness = await createIntegrationHarness(1_700_000_000_000);
  t.after(() => harness.tempDir.cleanup());

  // ── Step 1: Initial fetch (cache miss) ─────────────────────────────
  await harness.getProviderState();
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    1,
    'initial fetch should call list once',
  );

  // ── Step 2: Read within TTL (cache hit) ────────────────────────────
  harness.clock.advance(10_000); // 10s < 15s TTL
  harness.shell.resetCalls();
  await harness.getProviderState();
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    0,
    'within TTL: no additional list call',
  );

  // ── Step 3: Advance past TTL (cache stale) ────────────────────────
  harness.clock.advance(6_000); // total 16s > 15s TTL
  harness.shell.resetCalls();
  await harness.getProviderState();
  assert.equal(
    harness.shell.calls.filter(c => c.args[1] === 'list').length,
    1,
    'after TTL expiry: should refetch from command',
  );
});
