import type { TestContext } from 'node:test';
import type { UsageState } from '../../src/usage.ts';
import * as realUsage from '../../src/usage.ts';

export interface MockUsageHandle {
  setState(provider: string, state: UsageState | Error): void;
  readonly calls: ReadonlyArray<{ provider: string; kind: 'getProviderUsageState' | 'invalidateUsageCache' }>;
}

export function mockUsage(
  t: TestContext,
  initial?: Record<string, UsageState | Error>,
): MockUsageHandle {
  const store = new Map<string, UsageState | Error>(Object.entries(initial ?? {}));
  const calls: Array<{ provider: string; kind: 'getProviderUsageState' | 'invalidateUsageCache' }> = [];

  async function getProviderUsageState(provider: string): Promise<UsageState> {
    calls.push({ provider, kind: 'getProviderUsageState' });
    const state = store.get(provider);
    if (state === undefined) {
      throw new Error(`no mock response for provider: ${provider}`);
    }
    if (state instanceof Error) {
      throw state;
    }
    return state;
  }

  async function invalidateUsageCache(): Promise<void> {
    calls.push({ provider: '', kind: 'invalidateUsageCache' });
  }

  t.mock.module('../../src/usage.ts', {
    namedExports: {
      ...realUsage,
      getProviderUsageState,
      invalidateUsageCache,
    },
  });

  return {
    setState(provider, state) {
      store.set(provider, state);
    },
    get calls() {
      return calls;
    },
  };
}
