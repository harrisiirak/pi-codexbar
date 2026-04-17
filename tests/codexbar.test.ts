import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBinary, runJson } from '../src/codexbar.ts';
import { createFakeCodexbar } from './helpers/fake-codexbar.ts';

test('discoverBinary is a function', () => {
  assert.equal(typeof discoverBinary, 'function');
});

test('runJson parses valid JSON from fake binary', async (t) => {
  const data = { hello: 'world' };
  const fake = await createFakeCodexbar({ 'test --json': JSON.stringify(data) });
  t.after(() => fake.cleanup());

  const result = await runJson(fake.binPath, ['test', '--json']);
  assert.deepEqual(result, data);
});

test('runJson throws on non-zero exit', async (t) => {
  const fake = await createFakeCodexbar({});
  t.after(() => fake.cleanup());

  await assert.rejects(
    () => runJson(fake.binPath, ['unknown']),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('codexbar failed'));
      return true;
    },
  );
});

test('runJson throws on invalid JSON', async (t) => {
  const fake = await createFakeCodexbar({ 'test --json': 'not json' });
  t.after(() => fake.cleanup());

  await assert.rejects(
    () => runJson(fake.binPath, ['test', '--json']),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      return true;
    },
  );
});
