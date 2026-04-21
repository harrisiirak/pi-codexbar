import type { Model } from '@mariozechner/pi-ai';
import type { UsageState } from '../../src/usage.ts';

export const TEST_MODELS: Model<string>[] = [
  { id: 'gpt-4o', name: 'GPT-4o', api: 'openai-completions', provider: 'openai', baseUrl: 'https://api.openai.com/v1', reasoning: false, input: ['text', 'image'], cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 } as unknown as Model<string>,
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', api: 'openai-completions', provider: 'openai', baseUrl: 'https://api.openai.com/v1', reasoning: false, input: ['text'], cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 } as unknown as Model<string>,
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', reasoning: true, input: ['text', 'image'], cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 } as unknown as Model<string>,
];

export const CLAUDE_USAGE_STATE: UsageState = {
  selectedProvider: 'claude',
  fetchedAt: Date.now(),
  entries: [{
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
  }],
};

export const CODEX_USAGE_STATE: UsageState = {
  selectedProvider: 'codex',
  fetchedAt: Date.now(),
  entries: [{
    providerId: 'codex',
    status: 'ok',
    metrics: {
      primary: { usedPercent: 20, windowMinutes: 300, resetsAt: '2026-04-18T14:00:00Z', resetDescription: 'Apr 18 at 5:00PM' },
      secondary: { usedPercent: 10, windowMinutes: 10080, resetsAt: null, resetDescription: null },
      tertiary: null,
      creditsRemaining: null,
      loginMethod: 'OpenAI Pro',
      updatedAt: null,
    },
  }],
};
