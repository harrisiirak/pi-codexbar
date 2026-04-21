import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockUsage } from './mock-usage.ts';
import type { UsageState } from '../../src/usage.ts';

const CLAUDE_STATE: UsageState = {
  selectedProvider: 'claude',
  fetchedAt: Date.now(),
  entries: [
    {
      providerId: 'claude',
      status: 'ok',
      metrics: {
        primary: { usedPercent: 11, windowMinutes: 300, resetsAt: '2026-04-18T14:00:00Z', resetDescription: 'Apr 18 at 5:00PM' },
        secondary: { usedPercent: 7, windowMinutes: 10080, resetsAt: null, resetDescription: null },
        tertiary: null,
        creditsRemaining: null,
        loginMethod: 'Claude Max',
        updatedAt: null,
      },
    },
  ],
};

describe('mock-usage helper', () => {
  it('mocks getProviderUsageState with initial state', async (t) => {
    const handle = mockUsage(t, { claude: CLAUDE_STATE });
    const usage = await import('../../src/usage.ts');
    const state = await usage.getProviderUsageState('claude');
    assert.deepStrictEqual(state, CLAUDE_STATE);
    assert.strictEqual(handle.calls.length, 1);
    assert.deepStrictEqual(handle.calls[0], { provider: 'claude', kind: 'getProviderUsageState' });
  });

  it('mocks getProviderUsageState with setState error', async (t) => {
    const handle = mockUsage(t);
    const usage = await import('../../src/usage.ts');
    handle.setState('openai', new Error('unauthorized'));
    await assert.rejects(() => usage.getProviderUsageState('openai'), /unauthorized/);
    assert.strictEqual(handle.calls.length, 1);
    assert.deepStrictEqual(handle.calls[0], { provider: 'openai', kind: 'getProviderUsageState' });
  });

  it('invalidateUsageCache resolves and records call', async (t) => {
    const handle = mockUsage(t);
    const usage = await import('../../src/usage.ts');
    await usage.invalidateUsageCache();
    assert.strictEqual(handle.calls.length, 1);
    assert.deepStrictEqual(handle.calls[0], { provider: '', kind: 'invalidateUsageCache' });
  });

  it('rejects for unregistered provider', async (t) => {
    const handle = mockUsage(t);
    const usage = await import('../../src/usage.ts');
    await assert.rejects(() => usage.getProviderUsageState('unknown'), /no mock response for provider: unknown/);
    assert.strictEqual(handle.calls.length, 1);
    assert.deepStrictEqual(handle.calls[0], { provider: 'unknown', kind: 'getProviderUsageState' });
  });
});
