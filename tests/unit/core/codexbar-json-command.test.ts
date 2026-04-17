import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodexbarJson } from '../../../src/core/codexbar-json-command.ts';
import { createFakeCodexbar } from '../../helpers/fake-codexbar.ts';

test('codexbar-json-command module is importable at runtime', async () => {
  const mod = await import('../../../src/core/codexbar-json-command.ts');
  assert.equal(typeof mod.runCodexbarJson, 'function');
});

test('returns parsed object when stdout is valid JSON', async (t) => {
  const data = { providers: [{ id: 'openai' }] };
  const fake = await createFakeCodexbar({
    'status --json': JSON.stringify(data),
  });
  t.after(() => fake.cleanup());

  const result = await runCodexbarJson(fake.binPath, ['status', '--json']);
  assert.deepEqual(result, data);
});

test('throws on non-zero exit', async (t) => {
  const fake = await createFakeCodexbar({});
  t.after(() => fake.cleanup());

  await assert.rejects(
    () => runCodexbarJson(fake.binPath, ['unknown', 'command']),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('codexbar command failed'));
      return true;
    },
  );
});

test('throws on invalid JSON stdout', async (t) => {
  const fake = await createFakeCodexbar({
    'status --json': 'not json at all',
  });
  t.after(() => fake.cleanup());

  await assert.rejects(
    () => runCodexbarJson(fake.binPath, ['status', '--json']),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('invalid JSON'));
      return true;
    },
  );
});
