/**
 * Provider-state adapter — the single orchestrator for discovery,
 * JSON command execution, normalization, and caching.
 */

import type { ProviderId, ProviderState, ProviderStateAdapter } from './provider-state-contract.ts';

export interface CreateProviderStateAdapterDeps {
  nowEpochMs: () => number;
  discoverBinary: () => string;
  runJson: <T>(binaryPath: string, args: string[], timeoutMs: number) => Promise<T>;
  normalize: (raw: unknown, nowEpochMs: number) => ProviderState;
  cache: {
    read: (nowEpochMs: number) => Promise<ProviderState | null>;
    write: (state: ProviderState) => Promise<void>;
    invalidate: () => Promise<void>;
  };
  listArgs: string[];
  switchArgsForProvider: (providerId: ProviderId) => string[];
  timeoutMs: number;
}

export function createProviderStateAdapter(deps: CreateProviderStateAdapterDeps): ProviderStateAdapter {
  const { nowEpochMs, discoverBinary, runJson, normalize, cache, listArgs, switchArgsForProvider, timeoutMs } = deps;

  /** Fetch fresh state from the CLI, normalize, and write to cache. */
  async function fetchAndCacheProviderState(): Promise<ProviderState> {
    const binaryPath = discoverBinary();
    const raw = await runJson<unknown>(binaryPath, listArgs, timeoutMs);
    const state = normalize(raw, nowEpochMs());
    await cache.write(state);
    return state;
  }

  return {
    async getProviderState(): Promise<ProviderState> {
      const now = nowEpochMs();
      const cached = await cache.read(now);
      if (cached !== null) {
        return cached;
      }
      return fetchAndCacheProviderState();
    },

    async setProvider(providerId: ProviderId): Promise<void> {
      const binaryPath = discoverBinary();
      const args = switchArgsForProvider(providerId);
      await runJson<unknown>(binaryPath, args, timeoutMs);
      await cache.invalidate();
    },
  };
}
