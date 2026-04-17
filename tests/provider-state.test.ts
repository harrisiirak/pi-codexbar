import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getProviderState, setProvider } from '../src/provider-state.ts';

async function createStatefulFakeCodexbar() {
  const dir = join(tmpdir(), `fake-codexbar-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const binPath = join(dir, 'codexbar');
  const stateFile = join(dir, 'state');
  const callLog = join(dir, 'calls');

  await writeFile(stateFile, 'openai', 'utf-8');
  await writeFile(callLog, '', 'utf-8');

  const script = `#!/bin/sh
STATE_FILE="${stateFile}"
echo "$*" >> "${callLog}"
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
    getCalls: async () => (await readFile(callLog, 'utf-8')).trim().split('\n').filter(Boolean),
    resetCalls: () => writeFile(callLog, '', 'utf-8'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function tmpCacheDir() {
  const dir = join(tmpdir(), `pi-cache-test-${randomUUID()}`);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('getProviderState fetches and normalizes from CLI', async (t) => {
  const fake = await createStatefulFakeCodexbar();
  const cache = tmpCacheDir();
  t.after(async () => { await fake.cleanup(); await cache.cleanup(); });

  const state = await getProviderState(fake.binPath, cache.dir);
  assert.equal(state.selectedId, 'openai');
  assert.equal(state.providers.length, 2);
  assert.equal(state.providers[0].label, 'OpenAI');
});

test('getProviderState returns cached on second call', async (t) => {
  const fake = await createStatefulFakeCodexbar();
  const cache = tmpCacheDir();
  t.after(async () => { await fake.cleanup(); await cache.cleanup(); });

  await getProviderState(fake.binPath, cache.dir);
  await fake.resetCalls();
  await getProviderState(fake.binPath, cache.dir);

  const calls = await fake.getCalls();
  assert.equal(calls.length, 0, 'second call should hit cache');
});

test('setProvider switches and clears cache', async (t) => {
  const fake = await createStatefulFakeCodexbar();
  const cache = tmpCacheDir();
  t.after(async () => { await fake.cleanup(); await cache.cleanup(); });

  await getProviderState(fake.binPath, cache.dir);
  await setProvider('anthropic', fake.binPath, cache.dir);

  const state = await getProviderState(fake.binPath, cache.dir);
  assert.equal(state.selectedId, 'anthropic');
});

test('full lifecycle: miss → hit → switch → miss', async (t) => {
  const fake = await createStatefulFakeCodexbar();
  const cache = tmpCacheDir();
  t.after(async () => { await fake.cleanup(); await cache.cleanup(); });

  // miss
  const s1 = await getProviderState(fake.binPath, cache.dir);
  assert.equal(s1.selectedId, 'openai');

  // hit (no CLI call)
  await fake.resetCalls();
  await getProviderState(fake.binPath, cache.dir);
  assert.equal((await fake.getCalls()).length, 0);

  // switch
  await setProvider('anthropic', fake.binPath, cache.dir);

  // miss after invalidation
  await fake.resetCalls();
  const s2 = await getProviderState(fake.binPath, cache.dir);
  assert.equal(s2.selectedId, 'anthropic');
  assert.equal((await fake.getCalls()).filter(c => c.includes('list')).length, 1);
});
