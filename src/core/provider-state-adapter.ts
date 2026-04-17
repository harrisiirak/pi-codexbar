import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderId, ProviderState, ProviderStateAdapter } from './provider-state-contract.ts';
import { discoverCodexbarBinary } from './codexbar-binary-discovery.ts';
import { runCodexbarJson } from './codexbar-json-command.ts';
import { normalizeProviderState } from './provider-state-normalizer.ts';
import { createProviderStateCacheStore } from '../cache/provider-state-cache-store.ts';
import { providerStateCacheRelativePath } from '../config/provider-state-cache-policy.ts';

const execFileAsync = promisify(execFile);
const LIST_ARGS = ['provider', 'list', '--json'];
const TIMEOUT_MS = 5000;

export interface CreateProviderStateAdapterOptions {
  cacheDir?: string;
  binaryPath?: string;
}

export function createProviderStateAdapter(
  options: CreateProviderStateAdapterOptions = {},
): ProviderStateAdapter {
  const cacheFilePath = join(options.cacheDir ?? process.cwd(), providerStateCacheRelativePath);
  const cache = createProviderStateCacheStore(cacheFilePath);

  async function fetchAndCache(): Promise<ProviderState> {
    const binaryPath = options.binaryPath ?? discoverCodexbarBinary();
    const raw = await runCodexbarJson<unknown>(binaryPath, LIST_ARGS, TIMEOUT_MS);
    const state = normalizeProviderState(raw, Date.now());
    await cache.write(state);
    return state;
  }

  return {
    async getProviderState(): Promise<ProviderState> {
      const cached = await cache.read(Date.now());
      if (cached) return cached;
      return fetchAndCache();
    },

    async setProvider(providerId: ProviderId): Promise<void> {
      const binaryPath = options.binaryPath ?? discoverCodexbarBinary();
      try {
        await execFileAsync(binaryPath, ['provider', 'switch', providerId], { timeout: TIMEOUT_MS });
      } catch (err: unknown) {
        const e = err as { killed?: boolean; code?: string; stderr?: string };
        if (e.killed || e.code === 'ETIMEDOUT') {
          throw new Error('codexbar provider switch timed out');
        }
        throw new Error(`codexbar provider switch failed: ${e.stderr ?? ''}`);
      }
      await cache.invalidate();
    },
  };
}
