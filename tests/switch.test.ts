import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Model } from '@mariozechner/pi-ai';
import type { ScoredCandidate } from '../src/switch.ts';
import { loadAliases, formatListing, resolveBuiltIn, resolveCandidates, scoreCandidates, rankScored, runSwitch, formatDryRun, parseSlashArgs } from '../src/switch.ts';
import { invalidateUsageCache } from '../src/usage.ts';
import { mockExec } from './helpers/mock-exec.ts';

function mockReadFile(files: Record<string, string>, errors?: Record<string, string>) {
  return (path: string, _encoding: 'utf-8') => {
    if (errors?.[path]) {
      const e: any = new Error(`${errors[path]}: ${path}`);
      e.code = errors[path];
      throw e;
    }
    if (path in files) return files[path];
    const e: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
    e.code = 'ENOENT';
    throw e;
  };
}

function model(overrides: Partial<Model<string>> & { id: string; provider: string }): Model<string> {
  return {
    name: overrides.id,
    api: 'openai-completions',
    baseUrl: 'https://api.example.com/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    ...overrides,
  } as Model<string>;
}

const mixedModels: Model<string>[] = [
  model({ id: 'cheap-text-only-a', provider: 'openai', cost: { input: 0.15, output: 0.60, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'cheap-text-only-b', provider: 'google', cost: { input: 0.10, output: 0.40, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'cheap-vision-c', provider: 'anthropic', input: ['text', 'image'], cost: { input: 0.25, output: 1.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'cheap-text-only-d', provider: 'groq', cost: { input: 0.05, output: 0.20, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'cheap-text-only-e', provider: 'xai', cost: { input: 0.20, output: 0.80, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'mid-vision-f', provider: 'openai', input: ['text', 'image'], cost: { input: 5.00, output: 15.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'mid-reasoning-g', provider: 'anthropic', reasoning: true, cost: { input: 3.00, output: 15.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'expensive-reasoning-h', provider: 'openai', reasoning: true, cost: { input: 30.00, output: 60.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'expensive-vision-i', provider: 'anthropic', input: ['text', 'image'], cost: { input: 15.00, output: 75.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'longctx-text-j', provider: 'google', contextWindow: 1_000_000, cost: { input: 1.25, output: 5.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'longctx-vision-k', provider: 'google', input: ['text', 'image'], contextWindow: 200_000, cost: { input: 1.25, output: 5.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'longctx-reasoning-l', provider: 'anthropic', reasoning: true, contextWindow: 200_000, cost: { input: 3.00, output: 15.00, cacheRead: 0, cacheWrite: 0 } }),
  model({ id: 'shortctx-m', provider: 'openai', contextWindow: 128_000, cost: { input: 10.00, output: 30.00, cacheRead: 0, cacheWrite: 0 } }),
];

describe('loadAliases', () => {
  test('merges both alias files', async () => {
    const load = mockReadFile({
      '/v/pi.json': JSON.stringify({ cheap: 'openai/gpt-4o-mini' }),
      '/v/cb.json': JSON.stringify({ fast: 'anthropic/claude-3-haiku' }),
    });

    const result = await loadAliases(['/v/pi.json', '/v/cb.json'], load);

    assert.ok(result.merged.cheap, 'should contain pi alias "cheap"');
    assert.deepEqual(result.merged.cheap, ['openai/gpt-4o-mini']);
    assert.ok(result.merged.fast, 'should contain codexbar alias "fast"');
    assert.deepEqual(result.merged.fast, ['anthropic/claude-3-haiku']);
  });

  test('later file overrides collisions', async () => {
    const load = mockReadFile({
      '/v/pi.json': JSON.stringify({ cheap: 'openai/gpt-4o-mini' }),
      '/v/cb.json': JSON.stringify({ cheap: 'anthropic/claude-3-haiku' }),
    });

    const result = await loadAliases(['/v/pi.json', '/v/cb.json'], load);

    assert.deepEqual(result.merged.cheap, ['anthropic/claude-3-haiku']);
  });

  test('malformed JSON records warning while loading the valid file', async () => {
    const load = mockReadFile({
      '/v/pi.json': JSON.stringify({ cheap: 'openai/gpt-4o-mini' }),
      '/v/cb.json': '{not valid json}',
    });

    const result = await loadAliases(['/v/pi.json', '/v/cb.json'], load);

    assert.deepEqual(result.merged.cheap, ['openai/gpt-4o-mini']);
    assert.ok(result.warnings.length > 0, 'should have at least one warning for malformed JSON');
    assert.ok(
      result.warnings.some(w => w.includes('/v/cb.json')),
      'warning should reference the malformed file path',
    );
  });

  test('invalid alias targets are skipped with warning', async () => {
    const load = mockReadFile({
      '/v/pi.json': JSON.stringify({
        good: 'openai/gpt-4o-mini',
        bad: 'not-a-slash-separator',
        also_bad: 'too/many/slashes/here',
      }),
    });

    const result = await loadAliases(['/v/pi.json'], load);

    assert.deepEqual(result.merged.good, ['openai/gpt-4o-mini']);
    assert.equal(result.merged.bad, undefined, 'invalid target "bad" should be skipped');
    assert.equal(result.merged.also_bad, undefined, 'invalid target "also_bad" should be skipped');
    assert.ok(result.warnings.length >= 2, 'should warn about each invalid target');
  });

  test('missing files are skipped silently (ENOENT)', async () => {
    const load = mockReadFile({});

    const result = await loadAliases(['/v/missing.json'], load);

    assert.deepEqual(result.merged, {});
    assert.equal(result.loadedPaths.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  test('non-ENOENT read errors are thrown', async () => {
    const load = mockReadFile({}, { '/v/locked.json': 'EACCES' });

    try {
      const result = await loadAliases(['/v/locked.json'], load);
      assert.fail(
        `Expected loadAliases to throw on permission-denied, but it returned: ${JSON.stringify(result)}`,
      );
    } catch (err: any) {
      assert.ok(err, 'should throw a non-null error');
      assert.match(
        err.code ?? '',
        /^(EACCES|EPERM)$/,
        `expected EACCES or EPERM, got: ${err.code ?? err.message}`,
      );
    }
  });
});

describe('formatListing', () => {
  test('includes built-ins, user aliases, and loaded paths', () => {
    const output = formatListing(
      { cheap: ['openai/gpt-4o-mini'], fast: ['anthropic/claude-3-haiku'] },
      { myalias: ['anthropic/claude-3-haiku'] },
      ['/home/user/.config/pi/aliases.json'],
    );

    assert.ok(output.includes('cheap'), 'should include built-in key');
    assert.ok(output.includes('fast'), 'should include built-in key');
    assert.ok(output.includes('myalias'), 'should include alias key');
    assert.ok(output.includes('/home/user/.config/pi/aliases.json'), 'should include loaded path');
  });
});

describe('resolveBuiltIn', () => {
  test('"cheap" returns top 5 models by ascending total cost', () => {
    const result = resolveBuiltIn('cheap', mixedModels);

    assert.equal(result.length, 5, 'cheap should return exactly 5 models');
    assert.equal(result[0].id, 'cheap-text-only-d');
    assert.equal(result[1].id, 'cheap-text-only-b');
    assert.equal(result[2].id, 'cheap-text-only-a');
    assert.equal(result[3].id, 'cheap-text-only-e');
    assert.equal(result[4].id, 'cheap-vision-c');
  });

  test('"vision" returns models with image in input', () => {
    const result = resolveBuiltIn('vision', mixedModels);

    assert.ok(result.length > 0, 'vision should return at least one model');
    for (const m of result) {
      assert.ok(
        m.input.includes('image'),
        `model "${m.id}" should accept image input, got: ${JSON.stringify(m.input)}`,
      );
    }
    const expectedVisionIds = mixedModels
      .filter(m => m.input.includes('image'))
      .map(m => m.id);
    const resultIds = result.map(m => m.id);
    for (const id of expectedVisionIds) {
      assert.ok(resultIds.includes(id), `vision result should include "${id}"`);
    }
  });

  test('"reasoning" returns models where reasoning is true', () => {
    const result = resolveBuiltIn('reasoning', mixedModels);

    assert.ok(result.length > 0, 'reasoning should return at least one model');
    for (const m of result) {
      assert.equal(m.reasoning, true, `model "${m.id}" should have reasoning === true`);
    }
    const expectedReasoningIds = mixedModels
      .filter(m => m.reasoning === true)
      .map(m => m.id);
    const resultIds = result.map(m => m.id);
    for (const id of expectedReasoningIds) {
      assert.ok(resultIds.includes(id), `reasoning result should include "${id}"`);
    }
  });

  test('"long-context" returns models with contextWindow >= 200_000', () => {
    const result = resolveBuiltIn('long-context', mixedModels);

    assert.ok(result.length > 0, 'long-context should return at least one model');
    for (const m of result) {
      assert.ok(
        m.contextWindow >= 200_000,
        `model "${m.id}" should have contextWindow >= 200_000, got ${m.contextWindow}`,
      );
    }
    const expectedLongContextIds = mixedModels
      .filter(m => m.contextWindow >= 200_000)
      .map(m => m.id);
    const resultIds = result.map(m => m.id);
    for (const id of expectedLongContextIds) {
      assert.ok(resultIds.includes(id), `long-context result should include "${id}"`);
    }
  });
});

describe('resolveCandidates', () => {
  test('exact provider/id match returns tier "exact"', () => {
    const result = resolveCandidates('openai/cheap-text-only-a', mixedModels, {});

    assert.equal(result.tier, 'exact');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].id, 'cheap-text-only-a');
  });

  test('exact match takes priority over alias and built-in', () => {
    const aliases = { mykey: ['openai/cheap-text-only-a'] };
    const result = resolveCandidates('openai/cheap-text-only-a', mixedModels, aliases);

    assert.equal(result.tier, 'exact');
    assert.equal(result.candidates[0].id, 'cheap-text-only-a');
  });

  test('model id lookup returns tier "registry"', () => {
    const result = resolveCandidates('cheap-text-only-a', mixedModels, {});

    assert.equal(result.tier, 'registry');
    assert.ok(result.candidates.length >= 1);
    assert.ok(result.candidates.some(m => m.id === 'cheap-text-only-a'));
  });

  test('model name lookup returns tier "registry"', () => {
    const models = [model({ id: 'gpt-4o', provider: 'openai', name: 'GPT-4o' })];
    const result = resolveCandidates('GPT-4o', models, {});

    assert.equal(result.tier, 'registry');
    assert.ok(result.candidates.length >= 1);
    assert.ok(result.candidates.some(m => m.id === 'gpt-4o'));
  });

  test('provider lookup returns tier "registry"', () => {
    const result = resolveCandidates('anthropic', mixedModels, {});

    assert.equal(result.tier, 'registry');
    assert.ok(result.candidates.length >= 1);
    for (const m of result.candidates) {
      assert.equal(m.provider, 'anthropic');
    }
  });

  test('alias key match returns tier "alias"', () => {
    const result = resolveCandidates('myalias', mixedModels, { myalias: ['openai/cheap-text-only-a'] });

    assert.equal(result.tier, 'alias');
    assert.ok(result.candidates.length >= 1);
  });

  test('alias key takes priority over built-in when same key exists', () => {
    const result = resolveCandidates('cheap', mixedModels, { cheap: ['openai/gpt-4o-mini'] });

    assert.equal(result.tier, 'alias');
    assert.ok(result.candidates.length >= 1);
  });

  test('built-in fallback returns tier "builtin"', () => {
    const result = resolveCandidates('cheap', mixedModels, {});

    assert.equal(result.tier, 'builtin');
    assert.ok(result.candidates.length >= 1);
  });

  test('token-subsequence handles prefixes (gemini-3 → gemini-3-pro)', () => {
    const models = [
      model({ id: 'gemini-3-pro', provider: 'google', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'gemini-2-flash', provider: 'google', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = resolveCandidates('gemini-3', models, {});

    assert.equal(result.tier, 'registry');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.id, 'gemini-3-pro');
  });

  test('token-subsequence handles dotted versions (gemini-3.1 → gemini-3-1-pro)', () => {
    const models = [
      model({ id: 'gemini-3-1-pro', provider: 'google', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'gemini-3-pro', provider: 'google', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = resolveCandidates('gemini-3.1', models, {});

    assert.equal(result.tier, 'registry');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.id, 'gemini-3-1-pro');
  });

  test('token-subsequence handles embedded versions (opus-4-7 → claude-opus-4-7)', () => {
    const models = [
      model({ id: 'claude-opus-4-7', provider: 'anthropic', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'claude-opus-4-1', provider: 'anthropic', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'gpt-4o', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = resolveCandidates('opus-4-7', models, {});

    assert.equal(result.tier, 'registry');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.id, 'claude-opus-4-7');
  });

  test('token-subsequence requires contiguous whole-token match', () => {
    const models = [
      model({ id: 'gpt-4o-pro', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = resolveCandidates('4', models, {});
    assert.equal(result.tier, 'none');
  });

  test('unresolved query returns tier "none"', () => {
    const result = resolveCandidates('nonexistent-query-xyzzy', mixedModels, {});

    assert.equal(result.tier, 'none');
    assert.equal((result as any).unknownKey, 'nonexistent-query-xyzzy');
    assert.equal(result.candidates.length, 0);
  });

  test('excludeProviders removes matching providers', () => {
    const result = resolveCandidates('anthropic', mixedModels, {}, ['anthropic']);

    assert.equal(result.tier, 'registry');
    for (const m of result.candidates) {
      assert.notEqual(m.provider, 'anthropic',
        `excluded provider "anthropic" should not appear in candidates, found: ${m.id}`);
    }
  });

  test('excludeProviders works with built-in tier', () => {
    const result = resolveCandidates('cheap', mixedModels, {}, ['openai']);

    assert.equal(result.tier, 'builtin');
    for (const m of result.candidates) {
      assert.notEqual(m.provider, 'openai',
        `excluded provider "openai" should not appear in candidates, found: ${m.id}`);
    }
  });
});

describe('scoreCandidates', () => {
  test('computes remaining = 100 - max(primary, secondary, tertiary)', async (t) => {
    await invalidateUsageCache();

    const models = [
      model({ id: 'model-a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'model-b', provider: 'anthropic', cost: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 } }),
    ];

    mockExec(t, {
      'usage --provider codex --format json': [{
        provider: 'codex',
        usage: {
          primary: { usedPercent: 30, windowMinutes: 300, resetsAt: '2026-04-20T00:00:00Z', resetDescription: 'Apr 20' },
          secondary: { usedPercent: 50, windowMinutes: 10080 },
          tertiary: null,
        },
      }],
      'usage --provider claude --format json': [{
        provider: 'claude',
        usage: {
          primary: { usedPercent: 10, windowMinutes: 300, resetsAt: '2026-04-19T12:00:00Z', resetDescription: 'Apr 19' },
          secondary: { usedPercent: 5, windowMinutes: 10080 },
          tertiary: { usedPercent: 3, windowMinutes: 43200 },
        },
      }],
    });

    const scored = await scoreCandidates(models);

    const scoredA = scored.find((s: any) => s.model.id === 'model-a');
    assert.ok(scoredA, 'should find model-a in scored results');
    assert.equal(scoredA.remaining, 50);

    const scoredB = scored.find((s: any) => s.model.id === 'model-b');
    assert.ok(scoredB, 'should find model-b in scored results');
    assert.equal(scoredB.remaining, 90);
  });

  test('captures unavailable usage as per-candidate error', async (t) => {
    await invalidateUsageCache();

    const models = [
      model({ id: 'model-x', provider: 'mistral', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];

    mockExec(t, {});

    const scored = await scoreCandidates(models);

    assert.equal(scored.length, 1, 'should include candidates even when usage is unavailable');
    const scoredX = scored.find((s: any) => s.model.id === 'model-x');
    assert.ok(scoredX, 'should find model-x in scored results');
    assert.ok(scoredX.error, 'should have an error field when usage is unavailable');
  });
});

describe('rankScored', () => {
  test('orders by remaining, then reset timestamp, then alphabetical', () => {
    const scored = [
      { model: model({ id: 'model-a', provider: 'openai' }), remaining: 80, primaryResetsAt: '2026-04-19T12:00:00Z' },
      { model: model({ id: 'model-b', provider: 'anthropic' }), remaining: 80, primaryResetsAt: '2026-04-19T18:00:00Z' },
      { model: model({ id: 'model-c', provider: 'google' }), remaining: 90, primaryResetsAt: '2026-04-18T00:00:00Z' },
    ];

    const result = rankScored(scored);

    assert.ok('ordered' in result, 'rankScored should return ordered result when candidates exist');
    if ('ordered' in result) {
      assert.equal(result.ordered[0].model.id, 'model-c');
      assert.equal(result.ordered[1].model.id, 'model-b');
      assert.equal(result.ordered[2].model.id, 'model-a');
    }
  });

  test('tiebreaks alphabetical when remaining and reset are equal', () => {
    const scored = [
      { model: model({ id: 'zebra', provider: 'zeta' }), remaining: 70, primaryResetsAt: '2026-04-19T12:00:00Z' },
      { model: model({ id: 'alpha', provider: 'alpha' }), remaining: 70, primaryResetsAt: '2026-04-19T12:00:00Z' },
    ];

    const result = rankScored(scored);

    assert.ok('ordered' in result, 'rankScored should return ordered result');
    if ('ordered' in result) {
      assert.equal(result.ordered[0].model.id, 'alpha');
      assert.equal(result.ordered[1].model.id, 'zebra');
    }
  });

  test('empty input returns all-unavailable error', () => {
    const result = rankScored([]);
    assert.deepEqual(result, { error: 'all-unavailable' });
  });
});

describe('runSwitch', () => {
  test('list action returns formatted text', async () => {
    const models = [
      model({ id: 'model-a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];

    const result = await runSwitch(
      { action: 'list', query: 'openai', excludeProviders: [], dryRun: false },
      models,
    );

    assert.equal(result.kind, 'list', 'list action should return kind "list"');
    assert.ok('text' in result, 'list action should expose shared formatted text');
    if (result.kind === 'list') {
      assert.ok(result.text.includes('Candidates for "openai"'), `expected formatted candidate heading, got: ${result.text}`);
      assert.ok(result.text.includes('openai/model-a'), `expected formatted candidate entry, got: ${result.text}`);
    }
  });

  test('switch + dryRun returns preview payload', async () => {
    const models = [
      model({ id: 'model-a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];

    const result = await runSwitch(
      { action: 'switch', query: 'openai', excludeProviders: [], dryRun: true },
      models,
    );

    assert.equal((result as any).kind, 'preview', 'dryRun switch should return kind "preview"');
  });

  test('no candidates yields error outcome', async () => {
    const models = [
      model({ id: 'model-a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];

    const result = await runSwitch(
      { action: 'switch', query: 'nonexistent-query-xyzzy', excludeProviders: [], dryRun: false },
      models,
    );

    assert.equal((result as any).kind, 'error', 'no-candidates should return kind "error"');
    assert.ok((result as any).message, 'error result should have a message');
  });

  test('bare list returns all available models', async () => {
    const models = [
      model({ id: 'a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'b', provider: 'anthropic', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = await runSwitch({ action: 'list', query: '', excludeProviders: [], dryRun: false }, models);
    assert.equal(result.kind, 'list');
    if (result.kind === 'list') {
      assert.equal(result.candidates.length, 2);
    }
  });

  test('bare list honors excludeProviders', async () => {
    const models = [
      model({ id: 'a', provider: 'openai', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
      model({ id: 'b', provider: 'anthropic', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
    ];
    const result = await runSwitch({ action: 'list', query: '', excludeProviders: ['openai'], dryRun: false }, models);
    assert.equal(result.kind, 'list');
    if (result.kind === 'list') {
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0]!.provider, 'anthropic');
    }
  });
});

describe('formatDryRun', () => {
  test('happy-path with winner and secondary candidate', () => {
    const scored: ScoredCandidate[] = [
      { model: model({ id: 'model-a', provider: 'openai' }), remaining: 80, primaryResetsAt: '2026-04-19T12:00:00Z' },
      { model: model({ id: 'model-b', provider: 'anthropic' }), remaining: 45, primaryResetsAt: null },
    ];

    const result = formatDryRun(scored);

    assert.ok(result.startsWith('📊 CodexBar Model Switch Preview\n'), 'should start with header');
    assert.ok(result.includes('Ranked candidates:'), 'should include ranked candidates section');
    assert.ok(result.includes('→ openai/model-a'), 'winner should have arrow prefix');
    assert.ok(result.includes('80% remaining'), 'should include remaining percentage');
    assert.ok(result.includes(', resets 2026-04-19T12:00:00Z'), 'should include resetsAt');
    assert.ok(result.includes('  anthropic/model-b'), 'secondary candidate should have space prefix');
    assert.ok(result.includes('45% remaining'), 'should include remaining for secondary');
  });

  test('error-line with warning emoji', () => {
    const scored: ScoredCandidate[] = [
      { model: model({ id: 'model-a', provider: 'openai' }), remaining: 80, primaryResetsAt: null },
      { model: model({ id: 'model-b', provider: 'anthropic' }), remaining: 0, primaryResetsAt: null, error: 'rate-limited' },
    ];

    const result = formatDryRun(scored);

    assert.ok(result.includes('⚠️ rate-limited'), 'error line should include warning emoji and error text');
    assert.ok(result.includes('anthropic/model-b'), 'error line should include provider/id');
  });

  test('empty ordered yields no-candidates message', () => {
    const result = formatDryRun([]);
    assert.ok(result.includes('No candidates available.'), 'empty input should show no candidates message');
  });
});

describe('parseSlashArgs', () => {
  test('bare "list" subcommand', () => {
    const result = parseSlashArgs('list');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'list');
      assert.equal(result.query, undefined);
    }
  });

  test('"list <query>" form', () => {
    const result = parseSlashArgs('list opus');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'list');
      assert.equal(result.query, 'opus');
    }
  });

  test('"switch <query>" form', () => {
    const result = parseSlashArgs('switch openai');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'switch');
      assert.equal(result.query, 'openai');
    }
  });

  test('--dry-run flag', () => {
    const result = parseSlashArgs('--dry-run openai');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'switch');
      assert.equal(result.dryRun, true);
      assert.equal(result.query, 'openai');
    }
  });

  test('--exclude comma-separated providers', () => {
    const result = parseSlashArgs('--exclude=openai,anthropic cheap');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.deepEqual(result.excludeProviders, ['openai', 'anthropic']);
      assert.equal(result.query, 'cheap');
    }
  });

  test('repeated --exclude accumulates', () => {
    const result = parseSlashArgs('--exclude=openai --exclude=anthropic cheap');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'switch');
      assert.deepEqual(result.excludeProviders, ['openai', 'anthropic']);
      assert.equal(result.query, 'cheap');
    }
  });

  test('unknown flags return error', () => {
    const result = parseSlashArgs('--bogus-flag something');
    assert.ok('error' in result);
    assert.ok(('error' in result) && result.error.length > 0);
  });

  test('empty args returns error', () => {
    const result = parseSlashArgs('');
    assert.ok('error' in result);
    assert.ok(('error' in result) && result.error.length > 0);
  });

  test('"list --dry-run" parses both', () => {
    const result = parseSlashArgs('list --dry-run');
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.action, 'list');
      assert.equal(result.dryRun, true);
      assert.deepEqual(result.excludeProviders, []);
    }
  });

  test('"--list" flag is rejected', () => {
    const result = parseSlashArgs('--list');
    assert.ok('error' in result);
  });
});
