import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type ProviderId,
  type ProviderDescriptor,
  type ProviderState,
  type ProviderStateAdapter,
} from '../../../src/core/provider-state-contract.ts';

/** Assert every key in `fields` exists on `obj`. */
function assertHasFields(obj: object, fields: string[]): void {
  for (const f of fields) {
    assert.ok(f in obj, `missing field: ${f}`);
  }
}

// ── Module resolves at runtime ────────────────────────────────────────
test('provider-state-contract module is importable at runtime', async () => {
  const mod = await import('../../../src/core/provider-state-contract.ts');
  assert.ok(mod, 'module should resolve');
});

// ── ProviderId ────────────────────────────────────────────────────────
test('ProviderId is a string type alias', () => {
  const id: ProviderId = 'openai';
  assert.equal(typeof id, 'string');
});

// ── ProviderDescriptor ────────────────────────────────────────────────
test('ProviderDescriptor requires id, label, enabled', () => {
  assertHasFields(
    { id: 'anthropic', label: 'Anthropic', enabled: true } satisfies ProviderDescriptor,
    ['id', 'label', 'enabled'],
  );
});

// ── ProviderState ─────────────────────────────────────────────────────
test('ProviderState requires providers, selectedProviderId, fetchedAtEpochMs', () => {
  assertHasFields(
    {
      providers: [{ id: 'x', label: 'X', enabled: true }],
      selectedProviderId: 'x',
      fetchedAtEpochMs: Date.now(),
    } satisfies ProviderState,
    ['providers', 'selectedProviderId', 'fetchedAtEpochMs'],
  );
});

// ── ProviderStateAdapter ──────────────────────────────────────────────
test('ProviderStateAdapter requires getProviderState and setProvider', () => {
  const adapter: ProviderStateAdapter = {
    async getProviderState() {
      return { providers: [], selectedProviderId: '', fetchedAtEpochMs: 0 };
    },
    async setProvider(_id: ProviderId) {},
  };
  assertHasFields(adapter, ['getProviderState', 'setProvider']);
});
