import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type CodexbarBinaryDiscoveryDeps,
  discoverCodexbarBinary,
} from '../../../src/core/codexbar-binary-discovery.ts';

// ── Module resolves at runtime ────────────────────────────────────────
test('codexbar-binary-discovery module is importable at runtime', async () => {
  const mod = await import('../../../src/core/codexbar-binary-discovery.ts');
  assert.ok(mod, 'module should resolve');
});

// ── macOS: /usr/local/bin/codexbar preferred when it exists ──────────
test('darwin: returns /usr/local/bin/codexbar when file exists', () => {
  const deps: CodexbarBinaryDiscoveryDeps = {
    platform: 'darwin',
    pathLookup: (_name: string) => '/opt/homebrew/bin/codexbar',
    fileExists: (_path: string) => true,
  };
  const result = discoverCodexbarBinary(deps);
  assert.equal(result, '/usr/local/bin/codexbar');
});

// ── macOS: falls back to PATH lookup when /usr/local/bin/codexbar missing
test('darwin: falls back to pathLookup when /usr/local/bin/codexbar missing', () => {
  const deps: CodexbarBinaryDiscoveryDeps = {
    platform: 'darwin',
    pathLookup: (_name: string) => '/opt/homebrew/bin/codexbar',
    fileExists: (_path: string) => false,
  };
  const result = discoverCodexbarBinary(deps);
  assert.equal(result, '/opt/homebrew/bin/codexbar');
});

// ── Linux: PATH lookup required ───────────────────────────────────────
test('linux: uses pathLookup for binary discovery', () => {
  const deps: CodexbarBinaryDiscoveryDeps = {
    platform: 'linux',
    pathLookup: (_name: string) => '/usr/bin/codexbar',
    fileExists: (_path: string) => true, // irrelevant on linux
  };
  const result = discoverCodexbarBinary(deps);
  assert.equal(result, '/usr/bin/codexbar');
});

// ── Error when binary unresolved ─────────────────────────────────────
test('throws Error with exact message when binary not found', () => {
  const deps: CodexbarBinaryDiscoveryDeps = {
    platform: 'darwin',
    pathLookup: (_name: string) => null,
    fileExists: (_path: string) => false,
  };
  assert.throws(
    () => discoverCodexbarBinary(deps),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      assert.equal(err.message, 'codexbar binary not found');
      return true;
    },
  );
});

test('linux: throws when pathLookup returns null', () => {
  const deps: CodexbarBinaryDiscoveryDeps = {
    platform: 'linux',
    pathLookup: (_name: string) => null,
    fileExists: (_path: string) => false,
  };
  assert.throws(
    () => discoverCodexbarBinary(deps),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      assert.equal(err.message, 'codexbar binary not found');
      return true;
    },
  );
});
