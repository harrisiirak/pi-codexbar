import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProviderStateAdapter } from '../../../src/core/provider-state-adapter.ts';
import { createTempCacheDir } from '../../helpers/temp-cache-dir.ts';

async function createStatefulFakeCodexbar() {
  const dir = join(tmpdir(), `fake-codexbar-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const binPath = join(dir, 'codexbar');
  const stateFile = join(dir, 'state');

  await writeFile(stateFile, 'openai', 'utf-8');

  const script = `#!/bin/sh
STATE_FILE="${stateFile}"
case "$2" in
  list)
    ACTIVE=$(cat "$STATE_FILE")
    if [ "$ACTIVE" = "anthropic" ]; then
      echo '{"providers":[{"id":"openai","name":"OpenAI","active":false},{"id":"anthropic","name":"Anthropic","active":true}],"active_provider":"anthropic"}'
    else
      echo '{"providers":[{"id":"openai","name":"OpenAI","active":true},{"id":"anthropic","name":"Anthropic","active":false}],"active_provider":"openai"}'
    fi
    ;;
  switch)
    echo "$3" > "$STATE_FILE"
    ;;
  *) echo "unknown: $*" >&2; exit 1 ;;
esac
`;

  await writeFile(binPath, script, 'utf-8');
  await chmod(binPath, 0o755);

  return {
    binPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test('provider-state-adapter module is importable at runtime', async () => {
  const mod = await import('../../../src/core/provider-state-adapter.ts');
  assert.equal(typeof mod.createProviderStateAdapter, 'function');
});

test('getProviderState fetches from fake CLI on cache miss', async (t) => {
  const tmp = await createTempCacheDir();
  const fake = await createStatefulFakeCodexbar();
  t.after(async () => { await tmp.cleanup(); await fake.cleanup(); });

  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: fake.binPath,
  });

  const state = await adapter.getProviderState();
  assert.equal(state.selectedProviderId, 'openai');
  assert.equal(state.providers.length, 2);
});

test('getProviderState returns cached state on second call within TTL', async (t) => {
  const tmp = await createTempCacheDir();
  const fake = await createStatefulFakeCodexbar();
  t.after(async () => { await tmp.cleanup(); await fake.cleanup(); });

  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: fake.binPath,
  });

  const state1 = await adapter.getProviderState();
  const state2 = await adapter.getProviderState();
  assert.deepEqual(state1, state2);
});

test('setProvider switches and invalidates cache', async (t) => {
  const tmp = await createTempCacheDir();
  const fake = await createStatefulFakeCodexbar();
  t.after(async () => { await tmp.cleanup(); await fake.cleanup(); });

  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: fake.binPath,
  });

  await adapter.getProviderState();
  await adapter.setProvider('anthropic');

  const state = await adapter.getProviderState();
  assert.equal(state.selectedProviderId, 'anthropic');
});

test('setProvider throws on unknown command', async (t) => {
  const tmp = await createTempCacheDir();
  const fake = await createStatefulFakeCodexbar();
  t.after(async () => { await tmp.cleanup(); await fake.cleanup(); });

  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: fake.binPath,
  });

  // The fake script exits 1 for unknown commands but 'switch' with any
  // provider id works, so test with a binary that always fails
  const failDir = join(tmpdir(), `fail-codexbar-${randomUUID()}`);
  await mkdir(failDir, { recursive: true });
  const failBin = join(failDir, 'codexbar');
  await writeFile(failBin, '#!/bin/sh\necho "error" >&2; exit 1', 'utf-8');
  await chmod(failBin, 0o755);
  t.after(() => rm(failDir, { recursive: true, force: true }));

  const failAdapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: failBin,
  });

  await assert.rejects(
    () => failAdapter.setProvider('anthropic'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('codexbar provider switch failed'));
      return true;
    },
  );
});
