import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getProviderUsageState, classifyError, invalidateUsageCache } from '../src/usage.ts';
import { mockExec } from './helpers/mock-exec.ts';

async function resetUsageCache() {
  await invalidateUsageCache();
}

const CLAUDE_USAGE = [{
  provider: 'claude',
  usage: {
    primary: { usedPercent: 11, windowMinutes: 300, resetsAt: '2026-04-18T14:00:00Z', resetDescription: 'Apr 18 at 5:00PM' },
    secondary: { usedPercent: 7, windowMinutes: 10080 },
    tertiary: null,
    loginMethod: 'Claude Max',
  },
}];

const KIMI_USAGE = [{
  provider: 'kimi',
  usage: {
    primary: { usedPercent: 5, resetsAt: '2026-04-24T09:00:33Z', resetDescription: '5/100 requests' },
    secondary: { usedPercent: 7, windowMinutes: 300, resetsAt: '2026-04-23T16:00:33Z', resetDescription: 'Rate: 7/100 per 5 hours' },
    tertiary: null,
    updatedAt: '2026-04-23T13:37:08Z',
  },
}];

const MIXED_PAYLOAD = {
  providers: [
    { provider: 'openai', usage: { primary: { usedPercent: 44, windowMinutes: 300, resetsAt: '2026-05-01T00:00:00Z' }, secondary: null, tertiary: null, creditsRemaining: 12.5 } },
    { provider: 'anthropic', error: { kind: 'auth', message: 'not logged in' } },
  ],
  selectedProvider: 'openai',
};

describe('getProviderUsageState', () => {
  test('known provider uses provider-specific usage command', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_USAGE });

    await getProviderUsageState('claude');

    const calls = mock.getCallStrings();
    assert.ok(calls.includes('usage --provider claude --format json'));
    assert.ok(!calls.includes('usage --provider all --json'));
  });

  test('unknown provider uses all-provider usage command', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, { 'usage --provider all --json': MIXED_PAYLOAD });

    await getProviderUsageState('unknown');

    assert.ok(mock.getCallStrings().includes('usage --provider all --json'));
  });

  test('known-provider failure does not call all-provider command', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, {});

    await assert.rejects(() => getProviderUsageState('claude'));
    assert.ok(!mock.getCallStrings().includes('usage --provider all --json'));
  });

  test('normalizes mixed success and error providers', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, { 'usage --provider all --json': MIXED_PAYLOAD });

    const state = await getProviderUsageState('unknown');

    assert.equal(state.entries[0].providerId, 'openai');
    assert.equal(state.entries[0].status, 'ok');
    if (state.entries[0].status === 'ok') {
      assert.equal(state.entries[0].metrics.primary?.usedPercent, 44);
      assert.equal(state.entries[0].metrics.creditsRemaining, 12.5);
    }

    assert.equal(state.entries[1].providerId, 'anthropic');
    assert.equal(state.entries[1].status, 'error');
    if (state.entries[1].status === 'error') {
      assert.equal(state.entries[1].error.kind, 'auth');
    }
  });

  test('normalizes kimi 5-hour rate limit into primary window', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    mockExec(t, { 'usage --provider kimi --format json': KIMI_USAGE });

    const state = await getProviderUsageState('kimi');

    assert.equal(state.entries[0].providerId, 'kimi');
    assert.equal(state.entries[0].status, 'ok');
    if (state.entries[0].status === 'ok') {
      assert.equal(state.entries[0].metrics.primary?.usedPercent, 7);
      assert.equal(state.entries[0].metrics.primary?.windowMinutes, 300);
      assert.equal(state.entries[0].metrics.primary?.resetDescription, 'Rate: 7/100 per 5 hours');
      assert.equal(state.entries[0].metrics.secondary?.usedPercent, 5);
      assert.equal(state.entries[0].metrics.secondary?.windowMinutes, null);
      assert.equal(state.entries[0].metrics.secondary?.resetDescription, '5/100 requests');
    }
  });
});

describe('classifyError', () => {
  test('is deterministic across known categories', () => {
    assert.equal(classifyError('Auth required'), 'auth');
    assert.equal(classifyError('invalid token'), 'auth');
    assert.equal(classifyError('Please login again'), 'auth');
    assert.equal(classifyError('not logged in'), 'auth');
    assert.equal(classifyError('session expired'), 'session');
    assert.equal(classifyError('Provider unavailable'), 'provider');
    assert.equal(classifyError('something went wrong'), 'unknown');
    assert.equal(classifyError('AUTH FAILED'), 'auth');
  });
});

describe('usage cache', () => {
  test('second read within TTL is a cache hit', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_USAGE });

    await getProviderUsageState('claude');
    mock.reset();
    await getProviderUsageState('claude');

    assert.equal(mock.getCalls().length, 0, 'second read should be cache hit');
  });

  test('invalidation forces next read to call CLI', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_USAGE });

    await getProviderUsageState('claude');
    await invalidateUsageCache();
    mock.reset();
    await getProviderUsageState('claude');

    assert.equal(mock.getCalls().length, 1, 'should call CLI after invalidation');
  });

  test('scoped by provider', async (t) => {
    await resetUsageCache();
    t.after(resetUsageCache);
    const mock = mockExec(t, {
      'usage --provider claude --format json': CLAUDE_USAGE,
      'usage --provider all --json': MIXED_PAYLOAD,
    });

    await getProviderUsageState('claude');
    await getProviderUsageState('unknown');

    assert.equal(mock.getCalls().length, 2, 'different providers should not share cache');
  });
});
