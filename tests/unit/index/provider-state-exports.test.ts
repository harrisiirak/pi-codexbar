import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  ProviderId,
  ProviderDescriptor,
  ProviderState,
  ProviderStateAdapter,
} from '../../../src/index.ts';

import { createProviderStateAdapter } from '../../../src/index.ts';

describe('package entrypoint exports (Plan 2 contract)', () => {
  it('exports createProviderStateAdapter as a function', () => {
    assert.equal(typeof createProviderStateAdapter, 'function');
  });

  it('preserves the scaffold main() export', async () => {
    const mod = await import('../../../src/index.ts');
    assert.equal(typeof mod.main, 'function');
    assert.equal(mod.main(), 'pi-codexbar scaffold initialized');
  });

  it('does not expose discovery internals', async () => {
    const mod = await import('../../../src/index.ts');
    assert.equal(mod.discoverCodexBarBinary, undefined);
  });

  it('does not expose cache internals', async () => {
    const mod = await import('../../../src/index.ts');
    assert.equal(mod.createProviderStateCacheStore, undefined);
  });
});
