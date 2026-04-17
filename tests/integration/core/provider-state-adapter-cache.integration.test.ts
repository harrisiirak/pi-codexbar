import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProviderStateAdapter } from '../../../src/core/provider-state-adapter.ts';
import { createTempCacheDir } from '../../helpers/temp-cache-dir.ts';

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
CALL_LOG="${callLog}"
echo "$*" >> "$CALL_LOG"
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

test('full adapter-cache lifecycle: miss → hit → invalidate → miss', async (t) => {
  const tmp = await createTempCacheDir();
  const fake = await createStatefulFakeCodexbar();
  t.after(async () => { await tmp.cleanup(); await fake.cleanup(); });

  const adapter = createProviderStateAdapter({
    cacheDir: tmp.path,
    binaryPath: fake.binPath,
  });

  // Step 1: cache miss — CLI called
  const state1 = await adapter.getProviderState();
  assert.equal(state1.selectedProviderId, 'openai');
  const calls1 = await fake.getCalls();
  assert.equal(calls1.filter(c => c.includes('list')).length, 1);

  // Step 2: cache hit — no CLI call
  await fake.resetCalls();
  const state2 = await adapter.getProviderState();
  assert.equal(state2.selectedProviderId, 'openai');
  const calls2 = await fake.getCalls();
  assert.equal(calls2.filter(c => c.includes('list')).length, 0);

  // Step 3: switch provider — invalidates cache
  await fake.resetCalls();
  await adapter.setProvider('anthropic');
  const calls3 = await fake.getCalls();
  assert.equal(calls3.filter(c => c.includes('switch')).length, 1);

  // Step 4: post-switch — cache miss, CLI called again
  await fake.resetCalls();
  const state3 = await adapter.getProviderState();
  assert.equal(state3.selectedProviderId, 'anthropic');
  const calls4 = await fake.getCalls();
  assert.equal(calls4.filter(c => c.includes('list')).length, 1);
});
