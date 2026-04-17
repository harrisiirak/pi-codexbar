import { join } from 'node:path';
import type { ProviderId, ProviderState, ProviderStateAdapter } from './provider-state-contract.ts';
import { discoverCodexbarBinary } from './codexbar-binary-discovery.ts';
import { runCodexbarJson } from './codexbar-json-command.ts';
import type { CodexbarJsonCommandDeps } from './codexbar-json-command.ts';
import { normalizeProviderState } from './provider-state-normalizer.ts';
import { createProviderStateCacheStore } from '../cache/provider-state-cache-store.ts';
import { providerStateCacheRelativePath } from '../config/provider-state-cache-policy.ts';

const LIST_ARGS = ['provider', 'list', '--json'];
const TIMEOUT_MS = 5000;

function switchArgs(providerId: ProviderId): string[] {
  return ['provider', 'switch', providerId];
}

export interface CreateProviderStateAdapterOptions {
  cacheDir?: string;
  shellRunner?: CodexbarJsonCommandDeps;
}

export function createProviderStateAdapter(
  options: CreateProviderStateAdapterOptions = {},
): ProviderStateAdapter {
  const cacheFilePath = join(options.cacheDir ?? process.cwd(), providerStateCacheRelativePath);
  const cache = createProviderStateCacheStore(cacheFilePath);
  const shellDeps: CodexbarJsonCommandDeps = options.shellRunner ?? {
    run: async (binaryPath, args, timeoutMs) => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      try {
        const { stdout, stderr } = await execFileAsync(binaryPath, args, { timeout: timeoutMs });
        return { exitCode: 0, stdout, stderr, timedOut: false };
      } catch (err: unknown) {
        const e = err as { code?: string; killed?: boolean; stdout?: string; stderr?: string; status?: number };
        if (e.killed || e.code === 'ETIMEDOUT') {
          return { exitCode: -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '', timedOut: true };
        }
        return { exitCode: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '', timedOut: false };
      }
    },
  };

  async function fetchAndCache(): Promise<ProviderState> {
    const binaryPath = discoverCodexbarBinary();
    const raw = await runCodexbarJson<unknown>(shellDeps, binaryPath, LIST_ARGS, TIMEOUT_MS);
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
      const binaryPath = discoverCodexbarBinary();
      const result = await shellDeps.run(binaryPath, switchArgs(providerId), TIMEOUT_MS);
      if (result.timedOut) {
        throw new Error('codexbar provider switch timed out');
      }
      if (result.exitCode !== 0) {
        throw new Error(`codexbar provider switch failed: ${result.stderr}`);
      }
      await cache.invalidate();
    },
  };
}
