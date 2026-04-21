import type { ProviderModelConfig } from '@mariozechner/pi-coding-agent';
import { loadAliases, BUILT_IN_KEYS } from './switch.ts';

export async function buildCodexbarProviderModels(): Promise<ProviderModelConfig[]> {
  const result = await loadAliases();

  const mergedKeys = Object.keys(result.merged);
  const builtInSet = new Set<string>(BUILT_IN_KEYS);
  const nonBuiltIns = mergedKeys
    .filter((k) => !builtInSet.has(k))
    .sort((a, b) => a.localeCompare(b));

  const orderedKeys = [...BUILT_IN_KEYS, ...nonBuiltIns];

  return orderedKeys.map((id): ProviderModelConfig => ({
    id,
    name: `CodexBar: ${id}`,
    api: 'anthropic-messages',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384,
  }));
}
