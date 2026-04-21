import { test, describe, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderModelConfig } from '@mariozechner/pi-coding-agent';
import { readFileSync } from 'node:fs';

function mockSwitch(
  t: TestContext,
  merged: Record<string, string[]>,
  builtIns: readonly string[] = ['cheap', 'vision', 'reasoning', 'long-context'],
) {
  t.mock.module('../src/switch.ts', {
    namedExports: {
      BUILT_IN_KEYS: builtIns,
      loadAliases: async () => ({
        merged,
        literalKeys: {},
        loadedPaths: [],
        warnings: [],
      }),
    },
  });
}

async function importRegister(t: TestContext) {
  const mod = await import(`../src/register.ts?bust=${Math.random()}`);
  return mod as typeof import('../src/register.ts');
}

describe('buildCodexbarProviderModels', () => {
  test('returns built-in keys first in canonical order, then non-built-ins alphabetically', async (t) => {
    mockSwitch(t, {
      cheap: ['anthropic/claude-3-haiku'],
      vision: ['openai/gpt-4o'],
      reasoning: ['anthropic/claude-3-opus'],
      'long-context': ['google/gemini-1.5-pro'],
      fast: ['groq/llama-3-8b'],
      custom: ['openai/gpt-4'],
      alpha: ['xai/grok-1'],
    });

    const { buildCodexbarProviderModels } = await importRegister(t);
    const models = await buildCodexbarProviderModels();

    const ids = models.map((m) => m.id);
    assert.deepEqual(ids, [
      'cheap',
      'vision',
      'reasoning',
      'long-context',
      'alpha',
      'custom',
      'fast',
    ]);
  });

  test('deduplicates alias keys matching built-ins', async (t) => {
    mockSwitch(t, {
      cheap: ['openai/gpt-4o-mini'],
      vision: ['openai/gpt-4o'],
      reasoning: ['anthropic/claude-3-opus'],
      'long-context': ['google/gemini-1.5-pro'],
    });

    const { buildCodexbarProviderModels } = await importRegister(t);
    const models = await buildCodexbarProviderModels();

    assert.equal(models.length, 4);
    const ids = models.map((m) => m.id);
    assert.deepEqual(ids, ['cheap', 'vision', 'reasoning', 'long-context']);
  });

  test('returns exact metadata for each model', async (t) => {
    mockSwitch(t, {
      cheap: ['openai/gpt-4o-mini'],
    });

    const { buildCodexbarProviderModels } = await importRegister(t);
    const models = await buildCodexbarProviderModels();

    assert.equal(models.length, 4);
    for (const m of models) {
      assert.equal(m.name, `CodexBar: ${m.id}`);
      assert.equal(m.api, 'anthropic-messages');
      assert.equal(m.reasoning, true);
      assert.deepEqual(m.input, ['text', 'image']);
      assert.deepEqual(m.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      assert.equal(m.contextWindow, 200_000);
      assert.equal(m.maxTokens, 16_384);
    }
  });

  test('boundary: src/register.ts does not import ExtensionAPI or call registerProvider', async () => {
    const source = readFileSync('src/register.ts', 'utf-8');
    assert.equal(
      source.includes('ExtensionAPI'),
      false,
      'src/register.ts must not contain ExtensionAPI'
    );
    assert.equal(
      source.includes('registerProvider('),
      false,
      'src/register.ts must not call registerProvider('
    );
  });
});
