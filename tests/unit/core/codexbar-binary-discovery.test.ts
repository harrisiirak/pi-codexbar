import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCodexbarBinary } from '../../../src/core/codexbar-binary-discovery.ts';

test('codexbar-binary-discovery module is importable at runtime', async () => {
  const mod = await import('../../../src/core/codexbar-binary-discovery.ts');
  assert.ok(mod);
  assert.equal(typeof mod.discoverCodexbarBinary, 'function');
});

test('darwin: returns /usr/local/bin/codexbar when file exists', () => {
  const result = discoverCodexbarBinary('darwin', () => true, () => '/opt/homebrew/bin/codexbar');
  assert.equal(result, '/usr/local/bin/codexbar');
});

test('darwin: falls back to PATH lookup when canonical missing', () => {
  const result = discoverCodexbarBinary('darwin', () => false, () => '/opt/homebrew/bin/codexbar');
  assert.equal(result, '/opt/homebrew/bin/codexbar');
});

test('linux: uses PATH lookup', () => {
  const result = discoverCodexbarBinary('linux', () => true, () => '/usr/bin/codexbar');
  assert.equal(result, '/usr/bin/codexbar');
});

test('throws when binary not found on darwin', () => {
  assert.throws(
    () => discoverCodexbarBinary('darwin', () => false, () => null),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'codexbar binary not found');
      return true;
    },
  );
});

test('throws when binary not found on linux', () => {
  assert.throws(
    () => discoverCodexbarBinary('linux', () => false, () => null),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'codexbar binary not found');
      return true;
    },
  );
});
