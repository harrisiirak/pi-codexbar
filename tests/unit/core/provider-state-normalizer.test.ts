import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeProviderState } from '../../../src/core/provider-state-normalizer.ts';
import type { ProviderState } from '../../../src/core/provider-state-contract.ts';

// ── Fixture helpers ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', '..', 'fixtures', 'provider-state');

async function loadFixture(name: string): Promise<unknown> {
  const raw = await readFile(join(fixtureDir, name), 'utf-8');
  return JSON.parse(raw);
}

// ── Module resolves at runtime ────────────────────────────────────────

test('provider-state-normalizer module is importable at runtime', async () => {
  const mod = await import('../../../src/core/provider-state-normalizer.ts');
  assert.ok(mod, 'module should resolve');
  assert.equal(typeof mod.normalizeProviderState, 'function');
});

// ── Valid minimal payload normalization ───────────────────────────────

test('normalizes a valid minimal payload with one provider', async () => {
  const raw = await loadFixture('codexbar-provider-list-minimal.json');
  const now = 1700000000000;

  const result: ProviderState = normalizeProviderState(raw, now);

  assert.equal(result.fetchedAtEpochMs, now);
  assert.equal(result.selectedProviderId, 'openai');
  assert.equal(result.providers.length, 1);
  assert.deepEqual(result.providers[0], {
    id: 'openai',
    label: 'OpenAI GPT-4',
    enabled: true,
  });
});

// ── Valid multi-provider payload with stable ordering ──────────────────

test('normalizes a valid multi-provider payload preserving order', async () => {
  const raw = await loadFixture('codexbar-provider-list-multi.json');
  const now = 1700000000001;

  const result: ProviderState = normalizeProviderState(raw, now);

  assert.equal(result.fetchedAtEpochMs, now);
  assert.equal(result.selectedProviderId, 'anthropic');
  assert.equal(result.providers.length, 3);

  // Order must be preserved as-is from the external payload
  assert.equal(result.providers[0].id, 'anthropic');
  assert.equal(result.providers[1].id, 'openai');
  assert.equal(result.providers[2].id, 'google');

  // Full descriptor mapping
  assert.deepEqual(result.providers[0], {
    id: 'anthropic',
    label: 'Anthropic Claude',
    enabled: true,
  });
  assert.deepEqual(result.providers[1], {
    id: 'openai',
    label: 'OpenAI GPT-4',
    enabled: false,
  });
  assert.deepEqual(result.providers[2], {
    id: 'google',
    label: 'Google Gemini',
    enabled: true,
  });
});

// ── Invalid payload rejection ─────────────────────────────────────────

test('throws on invalid payload where providers is not an array', async () => {
  const raw = await loadFixture('codexbar-provider-list-invalid.json');
  const now = 1700000000002;

  assert.throws(
    () => normalizeProviderState(raw, now),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be an Error instance');
      assert.ok(
        err.message.includes('providers') || err.message.includes('array'),
        `error message should mention providers/array, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('throws on null input', () => {
  assert.throws(
    () => normalizeProviderState(null, Date.now()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      return true;
    },
  );
});

test('throws on payload missing active_provider', () => {
  const raw = {
    providers: [{ id: 'openai', name: 'OpenAI', active: true }],
  };
  assert.throws(
    () => normalizeProviderState(raw, Date.now()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('active_provider') || err.message.includes('selectedProviderId'),
        `error should mention active_provider, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('throws when active_provider does not match any provider id', () => {
  const raw = {
    providers: [{ id: 'openai', name: 'OpenAI', active: true }],
    active_provider: 'nonexistent',
  };
  assert.throws(
    () => normalizeProviderState(raw, Date.now()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('active_provider') || err.message.includes('provider'),
        `error should mention mismatch, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('throws when a provider entry is missing required fields', () => {
  const raw = {
    providers: [{ id: 'openai' }], // missing name and active
    active_provider: 'openai',
  };
  assert.throws(
    () => normalizeProviderState(raw, Date.now()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      return true;
    },
  );
});
