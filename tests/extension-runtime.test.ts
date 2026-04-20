import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import createPiCodexbarExtension from '../src/extension.ts';
import { mockExec } from './helpers/mock-exec.ts';
import { stripAnsi, resetSettingsCache, userSettingsPath } from '../src/settings.ts';
import type { Model } from '@mariozechner/pi-ai';

const switchToolName = 'codexbar_switch_model';

async function withTempHome(t: any): Promise<string> {
  const home = join(tmpdir(), `pi-home-${randomUUID()}`);
  await mkdir(home, { recursive: true });
  const prev = process.env.HOME;
  process.env.HOME = home;
  resetSettingsCache();
  t.after(async () => {
    process.env.HOME = prev;
    resetSettingsCache();
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

type EventHandler = (...args: any[]) => Promise<void>;

const TEST_MODELS: Model<string>[] = [
  { id: 'gpt-4o', name: 'GPT-4o', api: 'openai-completions', provider: 'openai', baseUrl: 'https://api.openai.com/v1', reasoning: false, input: ['text', 'image'], cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 } as unknown as Model<string>,
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', api: 'openai-completions', provider: 'openai', baseUrl: 'https://api.openai.com/v1', reasoning: false, input: ['text'], cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 16_384 } as unknown as Model<string>,
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', reasoning: true, input: ['text', 'image'], cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 16_384 } as unknown as Model<string>,
];

function createFakePi(modelProvider?: string, availableModels?: Model<string>[]) {
  const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
  const events = new Map<string, EventHandler>();
  const notifications: Array<{ message: string; level: string }> = [];
  const widgets = new Map<string, { content: Function | string[] | undefined; options: any }>();
  const tools = new Map<string, any>();

  const fakeCtx = {
    model: modelProvider ? { provider: modelProvider } : undefined,
    modelRegistry: { getAll: () => TEST_MODELS, getAvailable: () => availableModels ?? TEST_MODELS },
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
      setStatus(_key: string, _value: string | undefined) {},
      setWidget(name: string, content: Function | string[] | undefined, options?: any) { widgets.set(name, { content, options }); },
    },
  };

  const setModelCalls: Model<any>[] = [];
  let setModelResult = true;

  return {
    pi: {
      registerCommand(name: string, def: any) { commands.set(name, def); },
      registerTool(tool: any) { tools.set(tool.name, tool); },
      on(event: string, handler: EventHandler) { events.set(event, handler); },
      setModel: async (_model: Model<any>): Promise<boolean> => { setModelCalls.push(_model); return setModelResult; },
    },
    callCommand: async (name: string, args = '') => { await commands.get(name)?.handler(args, fakeCtx); },
    emitEvent: async (name: string, event: any = {}) => { await events.get(name)?.(event, fakeCtx); },
    getCommand: (name: string) => commands.get(name),
    getCommandNames: () => [...commands.keys()],
    getTool: (name: string) => tools.get(name),
    getNotifications: () => [...notifications],
    renderWidget: (name: string): string[] => {
      const widget = widgets.get(name);
      if (!widget || widget.content == null) return [];
      if (Array.isArray(widget.content)) return widget.content;
      return widget.content().render(120);
    },
    hasWidget: (name: string) => widgets.has(name),
    getWidgetPlacement: (name: string) => widgets.get(name)?.options?.placement,
    getSetModelCalls: () => [...setModelCalls],
    setSetModelResult: (result: boolean) => { setModelResult = result; },
    modelRegistry: { getAll: () => TEST_MODELS, getAvailable: () => availableModels ?? TEST_MODELS },
  };
}

function tmpCacheDir() {
  const dir = join(tmpdir(), `pi-cache-test-${randomUUID()}`);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const CLAUDE_PAYLOAD = [{
  provider: 'claude',
  usage: {
    primary: { usedPercent: 11, windowMinutes: 300, resetsAt: '2026-04-18T14:00:00Z', resetDescription: 'Apr 18 at 5:00PM' },
    secondary: { usedPercent: 7, windowMinutes: 10080 },
    tertiary: null,
    loginMethod: 'Claude Max',
  },
}];

describe('command registration', () => {
  test('registers codexbar-toggle, codexbar-status, and codexbar-switch', () => {
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    assert.deepEqual(fakePi.getCommandNames().sort(), ['codexbar-status', 'codexbar-switch', 'codexbar-toggle']);
  });
});

describe('codexbar-toggle', () => {
  test('disables auto-refresh on events', async (t) => {
    await withTempHome(t);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-toggle', '');
    await fakePi.emitEvent('agent_end');
    await new Promise(r => setTimeout(r, 200));

    assert.equal(fakePi.renderWidget('codexbar-usage').length, 0);
  });

  test('clears widget when disabling', async (t) => {
    await withTempHome(t);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.emitEvent('agent_end');
    await new Promise(r => setTimeout(r, 500));
    assert.ok(fakePi.renderWidget('codexbar-usage').length > 0);

    await fakePi.callCommand('codexbar-toggle', '');
    assert.equal(fakePi.renderWidget('codexbar-usage').length, 0);
  });

  test('re-enables and re-renders immediately', async (t) => {
    await withTempHome(t);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-toggle', '');
    await fakePi.callCommand('codexbar-toggle', '');
    await new Promise(r => setTimeout(r, 500));

    assert.ok(fakePi.renderWidget('codexbar-usage').length > 0);
  });

  test('persists enabled=false to settings', async (t) => {
    await withTempHome(t);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-toggle', '');

    const raw = await readFile(userSettingsPath(), 'utf-8');
    assert.deepEqual(JSON.parse(raw), { enabled: false });
  });

  test('persisted disabled stays off across reloads', async (t) => {
    await withTempHome(t);
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    const first = createFakePi('claude');
    createPiCodexbarExtension(first.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await first.callCommand('codexbar-toggle', '');

    const second = createFakePi('claude');
    createPiCodexbarExtension(second.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await second.emitEvent('agent_end');
    await new Promise(r => setTimeout(r, 200));

    assert.equal(second.renderWidget('codexbar-usage').length, 0);
  });

  test('merges into existing settings without clobbering', async (t) => {
    await withTempHome(t);
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(userSettingsPath()), { recursive: true });
    await writeFile(userSettingsPath(), JSON.stringify({
      footer: { placement: 'aboveEditor' },
      colors: { session: '#abcdef' },
    }));
    resetSettingsCache();

    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-toggle', '');

    const raw = JSON.parse(await readFile(userSettingsPath(), 'utf-8'));
    assert.equal(raw.enabled, false);
    assert.equal(raw.footer.placement, 'aboveEditor');
    assert.equal(raw.colors.session, '#abcdef');
  });
});

describe('codexbar-status', () => {
  test('renders colored widget', async (t) => {
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-status', 'claude');

    assert.ok(fakePi.hasWidget('codexbar-usage'));
    const lines = fakePi.renderWidget('codexbar-usage');
    assert.equal(lines.length, 1);
    const plain = stripAnsi(lines[0]);
    assert.ok(plain.includes('claude'));
    assert.ok(plain.includes('11%'));
    assert.ok(plain.includes('7%'));
  });

  test('auto-detects provider from ctx.model', async (t) => {
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-status', '');
    assert.ok(fakePi.hasWidget('codexbar-usage'));
  });

  test('warns when no provider and no ctx', async (t) => {
    const mock = mockExec(t, {});
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    await fakePi.callCommand('codexbar-status', '');

    assert.equal(fakePi.getNotifications()[0].level, 'warning');
  });
});

describe('event auto-refresh', () => {
  test('agent_end refreshes widget', async (t) => {
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.emitEvent('agent_end');
    await new Promise(r => setTimeout(r, 500));

    assert.ok(fakePi.hasWidget('codexbar-usage'));
  });

  test('session_start refreshes widget', async (t) => {
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.emitEvent('session_start');
    await new Promise(r => setTimeout(r, 500));

    assert.ok(fakePi.hasWidget('codexbar-usage'));
  });

  test('no provider in ctx means no widget', async (t) => {
    const mock = mockExec(t, {});
    const fakePi = createFakePi();

    createPiCodexbarExtension(fakePi.pi);
    await fakePi.emitEvent('agent_end');
    await new Promise(r => setTimeout(r, 200));

    assert.equal(fakePi.hasWidget('codexbar-usage'), false);
  });

  test('widget placement matches settings', async (t) => {
    const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('claude');
    const cache = tmpCacheDir();
    t.after(async () => { await cache.cleanup(); });

    createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
    await fakePi.callCommand('codexbar-status', 'claude');
    assert.equal(fakePi.getWidgetPlacement('codexbar-usage'), 'belowEditor');
  });
});

describe('switch tool registration', () => {
  test('has correct name, parameters, and execute function', () => {
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    const tool = fakePi.getTool(switchToolName);
    assert.ok(tool);
    assert.equal(tool.name, 'codexbar_switch_model');
    assert.equal(tool.parameters?.type, 'object');
    assert.ok(tool.parameters?.properties?.action);
    assert.ok(tool.parameters?.properties?.query);
    assert.ok(tool.parameters?.properties?.excludeProviders);
    assert.ok(tool.parameters?.properties?.dryRun);
    assert.equal(typeof tool.execute, 'function');
  });

  test('has promptGuidelines for LLM usage', () => {
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    const tool = fakePi.getTool(switchToolName);
    assert.ok(tool);
    assert.ok(Array.isArray(tool.promptGuidelines));
    assert.ok(tool.promptGuidelines.some((line: string) => line.includes('action="list"') || line.includes('list candidates')));
    assert.ok(tool.promptGuidelines.some((line: string) => line.includes('dry run') || line.includes('dryRun')));
  });

  test('registers codexbar-switch slash command', () => {
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    const cmd = fakePi.getCommand('codexbar-switch');
    assert.ok(cmd);
    assert.equal(cmd.description, 'Switch models ranked by CodexBar usage budget');
    assert.equal(typeof cmd.handler, 'function');
  });
});

describe('switch tool execute', () => {
  test('non-dry-run calls pi.setModel', async (t) => {
    mockExec(t, {});
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    const tool = fakePi.getTool(switchToolName);

    const params = { action: 'switch' as const, query: 'openai', excludeProviders: [], dryRun: false };
    await tool.execute('call-1', params, undefined, undefined, fakePi);

    assert.ok(fakePi.getSetModelCalls().length >= 1);
  });

  test('dryRun does not call pi.setModel', async (t) => {
    mockExec(t, {});
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);
    const tool = fakePi.getTool(switchToolName);

    const params = { action: 'switch' as const, query: 'openai', excludeProviders: [], dryRun: true };
    await tool.execute('call-2', params, undefined, undefined, fakePi);

    assert.equal(fakePi.getSetModelCalls().length, 0);
  });

  test('setModel returning false yields error content', async (t) => {
    mockExec(t, {});
    const fakePi = createFakePi();
    fakePi.setSetModelResult(false);
    createPiCodexbarExtension(fakePi.pi);
    const tool = fakePi.getTool(switchToolName);

    const params = { action: 'switch' as const, query: 'openai', excludeProviders: [], dryRun: false };
    const result = await tool.execute('call-3', params, undefined, undefined, fakePi);

    assert.ok(
      result.content?.[0]?.text?.includes('❌') || result.content?.[0]?.text?.includes('Failed'),
    );
  });
});

describe('codexbar-switch slash command', () => {
  test('unknown query warns with warning emoji', async (t) => {
    mockExec(t, {});
    const fakePi = createFakePi();
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', 'nonexistent-model-xyzzy');

    const warning = fakePi.getNotifications().find(n => n.message.includes('⚠️'));
    assert.ok(warning);
  });

  test('usage unavailable notifies error', async (t) => {
    mockExec(t, {
      'usage --provider codex --format json': () => { throw new Error('no usage data'); },
    });
    const fakePi = createFakePi('openai');
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', 'openai');

    const errorNotify = fakePi.getNotifications().find(n => n.message.includes('❌'));
    assert.ok(errorNotify);
  });

  test('dry-run notifies breakdown and does not call setModel', async (t) => {
    mockExec(t, { 'usage --provider codex --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('openai');
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', '--dry-run openai');

    assert.ok(fakePi.getNotifications().find(n => n.message.includes('📊')));
    assert.equal(fakePi.getSetModelCalls().length, 0);
  });

  test('success notifies confirmation and calls setModel', async (t) => {
    mockExec(t, { 'usage --provider codex --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('openai');
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', 'openai');

    assert.ok(fakePi.getNotifications().find(n => n.message.includes('✅') || n.message.includes('Switched')));
    assert.ok(fakePi.getSetModelCalls().length >= 1);
  });

  test('emits progress notification', async (t) => {
    mockExec(t, { 'usage --provider codex --format json': CLAUDE_PAYLOAD });
    const fakePi = createFakePi('openai');
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', 'openai');

    assert.ok(fakePi.getNotifications().find(n => n.message.includes('⏳')));
  });

  test('ignores models without configured auth', async (t) => {
    const available = TEST_MODELS.filter(m => m.provider === 'openai');
    mockExec(t, {});
    const fakePi = createFakePi('openai', available);
    createPiCodexbarExtension(fakePi.pi);

    await fakePi.callCommand('codexbar-switch', 'claude-sonnet-4-20250514');

    assert.ok(fakePi.getNotifications().find(n => n.message.includes('⚠️')));
    assert.equal(fakePi.getSetModelCalls().length, 0);
  });
});
