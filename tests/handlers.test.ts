import { test, describe, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mockSettings, type MockSettingsHandle } from './helpers/mock-settings.ts';
import { mockUsage, type MockUsageHandle } from './helpers/mock-usage.ts';
import { mockExec } from './helpers/mock-exec.ts';
import { TEST_MODELS, CLAUDE_USAGE_STATE, CODEX_USAGE_STATE } from './helpers/fixtures.ts';
import type {
  ExtensionContext,
  ExtensionAPI,
  ExtensionUIContext,
  ExtensionWidgetOptions,
  SessionStartEvent,
  AgentEndEvent,
  ExtensionEvent,
} from '@mariozechner/pi-coding-agent';
import type { Model, TextContent } from '@mariozechner/pi-ai';
import type { CodexBarSettings } from '../src/settings.ts';
import type { UsageState } from '../src/usage.ts';
import type { SwitchOutcome, SwitchRequest } from '../src/switch.ts';

type MockFn<F extends (...args: any[]) => any> = ReturnType<typeof mock.fn<F>>;
type NotifyFn = ExtensionUIContext['notify'];
type SetStatusFn = ExtensionUIContext['setStatus'];
type SetWidgetFn = (key: string, content: string[] | undefined, options?: ExtensionWidgetOptions) => void;
type ModelSelectEvent = Extract<ExtensionEvent, { type: 'model_select' }>;
type ExtModule = typeof import('../src/extension.ts');

async function reloadModule<T>(t: TestContext, spec: string): Promise<T> {
  const fresh = await import(`${spec}?bust=${Math.random()}`);
  t.mock.module(spec, { namedExports: fresh });
  return fresh as T;
}

interface LoadOptions {
  settings?: Partial<CodexBarSettings>;
  usage?: Record<string, UsageState | Error>;
  exec?: Record<string, unknown>;
  switch?: { runSwitch?: (...args: any[]) => Promise<SwitchOutcome> };
}

interface LoadResult {
  ext: ExtModule;
  settings?: MockSettingsHandle;
  usage?: MockUsageHandle;
}

interface CtxStub {
  notify: MockFn<NotifyFn>;
  setWidget: MockFn<SetWidgetFn>;
  setStatus: MockFn<SetStatusFn>;
  ctx: ExtensionContext;
}

const SESSION_START_EVENT: SessionStartEvent = { type: 'session_start', reason: 'startup' };
const AGENT_END_EVENT: AgentEndEvent = { type: 'agent_end', messages: [] };

async function loadExtension(t: TestContext, opts: LoadOptions = {}): Promise<LoadResult> {
  const result: Partial<LoadResult> = {};
  if (opts.settings !== undefined) {
    result.settings = mockSettings(t, opts.settings);
  }
  if (opts.usage !== undefined) {
    result.usage = mockUsage(t, opts.usage);
  }
  if (opts.exec !== undefined) {
    mockExec(t, opts.exec);
  }
  await reloadModule(t, '../src/ui.ts');
  if (opts.switch?.runSwitch !== undefined) {
    const switchMod = await import(`../src/switch.ts?bust=${Math.random()}`);
    t.mock.module('../src/switch.ts', { namedExports: { ...switchMod, runSwitch: opts.switch.runSwitch } });
  } else {
    await reloadModule(t, '../src/switch.ts');
  }
  result.ext = (await import(`../src/extension.ts?bust=${Math.random()}`)) as ExtModule;
  return result as LoadResult;
}

function makeCtx(t: TestContext, opts?: { model?: { provider: string }; available?: Model<any>[] }): CtxStub {
  const notify = t.mock.fn<NotifyFn>();
  const setWidget = t.mock.fn<SetWidgetFn>();
  const setStatus = t.mock.fn<SetStatusFn>();
  const ctx = {
    model: opts?.model,
    hasUI: true,
    cwd: '/tmp',
    sessionManager: {},
    modelRegistry: {
      getAll: () => TEST_MODELS,
      getAvailable: () => opts?.available ?? TEST_MODELS,
    },
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => '',
    ui: { notify, setWidget, setStatus },
  } as unknown as ExtensionContext;
  return { notify, setWidget, setStatus, ctx };
}

function makePi(setModel: (m: Model<any>) => Promise<boolean> = async () => true): ExtensionAPI {
  return { setModel } as unknown as ExtensionAPI;
}

function modelSelectEvent(provider?: string): ModelSelectEvent {
  return {
    type: 'model_select',
    model: { provider } as unknown as Model<any>,
    previousModel: undefined,
    source: 'set',
  };
}

describe('handleSessionStart', () => {
  test('refreshes widget when enabled and provider known', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true }, usage: { claude: CLAUDE_USAGE_STATE } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleSessionStart(SESSION_START_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('does nothing when disabled', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: false } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleSessionStart(SESSION_START_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });

  test('does nothing when no provider', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true } });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleSessionStart(SESSION_START_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });
});

describe('handleAgentEnd', () => {
  test('refreshes widget when enabled and provider known', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true }, usage: { claude: CLAUDE_USAGE_STATE } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleAgentEnd(AGENT_END_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('does nothing when disabled', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: false } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleAgentEnd(AGENT_END_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });

  test('does nothing when no provider', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true } });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleAgentEnd(AGENT_END_EVENT, ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });
});

describe('handleModelSelect', () => {
  test('refreshes widget for provider from event.model', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true }, usage: { claude: CLAUDE_USAGE_STATE } });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleModelSelect(modelSelectEvent('anthropic'), ctx);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('does nothing when disabled', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: false } });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleModelSelect(modelSelectEvent('anthropic'), ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });

  test('does nothing when event.model has no provider', async (t) => {
    const { ext } = await loadExtension(t, { settings: { enabled: true } });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleModelSelect(modelSelectEvent(undefined), ctx);
    assert.equal(setWidget.mock.callCount(), 0);
  });
});

describe('createCodexbarAliasSelectHandler', () => {
  test('ignores non-codexbar selection', async (t) => {
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner: TEST_MODELS[0], ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    await handler(modelSelectEvent('anthropic'), ctx);
    assert.equal(runSwitchMock.mock.callCount(), 0);
    assert.equal(setModel.mock.callCount(), 0);
    assert.equal(notify.mock.callCount(), 0);
  });

  test('successful alias switch calls setModel and notifies', async (t) => {
    const winner = TEST_MODELS[0];
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner, ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    const firstRunSwitchCall = runSwitchMock.mock.calls[0];
    const [switchRequestArg, availableModelsArg] = firstRunSwitchCall!.arguments as unknown[];
    const switchRequest = switchRequestArg as SwitchRequest;
    assert.equal(switchRequest.action, 'switch');
    assert.equal(switchRequest.query, 'cheap');
    assert.deepEqual(switchRequest.excludeProviders, ['codexbar']);
    assert.equal(switchRequest.dryRun, false);

    assert.deepEqual(availableModelsArg, ctx.modelRegistry.getAvailable());
    assert.equal(setModel.mock.callCount(), 1);
    const firstSetModelCall = setModel.mock.calls[0];

    const [selectedWinnerArg] = firstSetModelCall!.arguments as unknown[];
    assert.equal(selectedWinnerArg, winner);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === '✅ cheap → openai/gpt-4o' && c.arguments[1] === 'info'));
  });

  test('excludes codexbar provider to prevent virtual model self-selection', async (t) => {
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner: TEST_MODELS[0], ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    const firstRunSwitchCall = runSwitchMock.mock.calls[0];
    const [reqArg] = firstRunSwitchCall!.arguments as unknown[];
    const req = reqArg as SwitchRequest;
    assert.deepEqual(req.excludeProviders, ['codexbar']);
  });

  test('warns when runSwitch returns error and does not call setModel', async (t) => {
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'error', message: 'No candidates matched "cheap".' } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    assert.equal(setModel.mock.callCount(), 0);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === '⚠️ No candidates matched "cheap".' && c.arguments[1] === 'warning'));
  });

  test('notifies error when setModel returns false', async (t) => {
    const winner = TEST_MODELS[0];
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner, ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => false);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    assert.equal(setModel.mock.callCount(), 1);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === '❌ Failed to switch to openai/gpt-4o — API key may not be configured.' && c.arguments[1] === 'error'));
  });

  test('warns when runSwitch returns non-switch and does not call setModel', async (t) => {
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'list', models: [] } as unknown as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    assert.equal(setModel.mock.callCount(), 0);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === '⚠️ Alias resolution did not return a switch candidate.' && c.arguments[1] === 'warning'));
  });

  test('suppresses recursive re-entry when setModel triggers handler again', async (t) => {
    const winner = TEST_MODELS[0];
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner, ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { switch: { runSwitch: runSwitchMock } });
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    let recursionDepth = 0;
    let handler: any;
    const setModel = t.mock.fn(async () => {
      recursionDepth++;
      if (recursionDepth === 1) {
        await handler(event, ctx);
      }
      return true;
    });
    handler = ext.createCodexbarAliasSelectHandler(makePi(setModel));
    const { ctx } = makeCtx(t);
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1, 'runSwitch should execute exactly once');
    assert.equal(setModel.mock.callCount(), 1, 'setModel should execute exactly once');
  });
});

describe('createModelSelectHandler', () => {
  test('composes alias handler and footer refresh for non-codexbar', async (t) => {
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner: TEST_MODELS[0], ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { settings: { enabled: true }, usage: { claude: CLAUDE_USAGE_STATE }, switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createModelSelectHandler(makePi(setModel));
    const { setWidget, ctx } = makeCtx(t);
    await handler(modelSelectEvent('anthropic'), ctx);
    assert.equal(runSwitchMock.mock.callCount(), 0);
    assert.equal(setModel.mock.callCount(), 0);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('composes alias handler and footer refresh for codexbar alias', async (t) => {
    const winner = TEST_MODELS[0];
    const runSwitchMock = t.mock.fn(async () => ({ kind: 'switch', winner, ordered: [] } as SwitchOutcome));
    const { ext } = await loadExtension(t, { settings: { enabled: true }, usage: { claude: CLAUDE_USAGE_STATE }, switch: { runSwitch: runSwitchMock } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createModelSelectHandler(makePi(setModel));
    const { setWidget, notify, ctx } = makeCtx(t);
    const event: ModelSelectEvent = {
      type: 'model_select',
      model: { provider: 'codexbar', id: 'cheap' } as unknown as Model<any>,
      previousModel: undefined,
      source: 'set',
    };
    await handler(event, ctx);
    assert.equal(runSwitchMock.mock.callCount(), 1);
    assert.equal(setModel.mock.callCount(), 1);
    assert.equal(setWidget.mock.callCount(), 1);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === '✅ cheap → openai/gpt-4o' && c.arguments[1] === 'info'));
  });
});

describe('handleToggleCommand', () => {
  test('toggles enabled=true → false, clears widget, notifies disabled', async (t) => {
    const { ext, settings } = await loadExtension(t, { settings: { enabled: true } });
    const { notify, setWidget, ctx } = makeCtx(t);
    await ext.handleToggleCommand('', ctx);
    assert.equal(settings!.get().enabled, false);
    assert.equal(setWidget.mock.callCount(), 1);
    assert.equal(setWidget.mock.calls[0].arguments[1], undefined);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[0] === 'CodexBar widget disabled' && c.arguments[1] === 'info'));
  });

  test('toggles enabled=false → true, notifies enabled, calls refreshFooter', async (t) => {
    const { ext, settings } = await loadExtension(t, { settings: { enabled: false }, usage: { claude: CLAUDE_USAGE_STATE } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleToggleCommand('', ctx);
    assert.equal(settings!.get().enabled, true);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('preserves nested footer/colors settings when persisting', async (t) => {
    const { ext, settings } = await loadExtension(t, {
      settings: { footer: { placement: 'aboveEditor' } as any, colors: { session: '#abcdef' } as any },
    });
    const { ctx } = makeCtx(t);
    await ext.handleToggleCommand('', ctx);
    assert.equal(settings!.get().footer.placement, 'aboveEditor');
    assert.equal(settings!.get().colors.session, '#abcdef');
  });
});

describe('handleStatusCommand', () => {
  test('renders widget for explicit provider arg', async (t) => {
    const { ext } = await loadExtension(t, { usage: { claude: CLAUDE_USAGE_STATE } });
    const { notify, setWidget, ctx } = makeCtx(t);
    await ext.handleStatusCommand('claude', ctx);
    assert.equal(setWidget.mock.callCount(), 1);
    assert.equal(setWidget.mock.calls[0].arguments[0], 'codexbar-usage');
    assert.ok(Array.isArray(setWidget.mock.calls[0].arguments[1]));
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'info' && c.arguments[0].includes('claude')));
  });

  test('auto-detects provider from ctx.model when args empty', async (t) => {
    const { ext } = await loadExtension(t, { usage: { claude: CLAUDE_USAGE_STATE } });
    const { setWidget, ctx } = makeCtx(t, { model: { provider: 'anthropic' } });
    await ext.handleStatusCommand('', ctx);
    assert.equal(setWidget.mock.callCount(), 1);
  });

  test('warns when no provider resolvable', async (t) => {
    const { ext } = await loadExtension(t);
    const { notify, ctx } = makeCtx(t);
    await ext.handleStatusCommand('', ctx);
    assert.equal(notify.mock.callCount(), 1);
    assert.equal(notify.mock.calls[0].arguments[1], 'warning');
  });

  test('notifies error when getProviderUsageState throws', async (t) => {
    const { ext } = await loadExtension(t, { usage: { claude: new Error('unauthorized') } });
    const { notify, ctx } = makeCtx(t);
    await ext.handleStatusCommand('claude', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'error' && c.arguments[0].includes('Failed to fetch')));
  });

  test('uses configured placement', async (t) => {
    const { ext } = await loadExtension(t, {
      settings: { footer: { placement: 'aboveEditor' } as any },
      usage: { claude: CLAUDE_USAGE_STATE },
    });
    const { setWidget, ctx } = makeCtx(t);
    await ext.handleStatusCommand('claude', ctx);
    assert.equal(setWidget.mock.calls[0].arguments[2]?.placement, 'aboveEditor');
  });
});

describe('createSwitchToolExecutor', () => {
  test('dryRun=true does not call pi.setModel and returns preview text', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const exec = ext.createSwitchToolExecutor(makePi(setModel));
    const { ctx } = makeCtx(t);
    const result = await exec('call-1', { action: 'switch', query: 'openai', dryRun: true }, undefined, undefined, ctx);
    assert.equal(setModel.mock.callCount(), 0);
    assert.equal(result.content[0].type, 'text');
  });

  test('non-dry-run calls pi.setModel on success', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE, codex: CODEX_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const exec = ext.createSwitchToolExecutor(makePi(setModel));
    const { ctx } = makeCtx(t);
    await exec('call-1', { action: 'switch', query: 'openai' }, undefined, undefined, ctx);
    assert.ok(setModel.mock.callCount() >= 1);
  });

  test('setModel returning false yields failure text', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE, codex: CODEX_USAGE_STATE } });
    const setModel = t.mock.fn(async () => false);
    const exec = ext.createSwitchToolExecutor(makePi(setModel));
    const { ctx } = makeCtx(t);
    const result = await exec('call-1', { action: 'switch', query: 'openai' }, undefined, undefined, ctx);
    assert.ok((result.content[0] as TextContent).text.includes('Failed'));
  });

  test('list action does not call pi.setModel', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const exec = ext.createSwitchToolExecutor(makePi(setModel));
    const { ctx } = makeCtx(t);
    await exec('call-1', { action: 'list', query: 'openai' }, undefined, undefined, ctx);
    assert.equal(setModel.mock.callCount(), 0);
  });
});

describe('createSwitchCommandHandler', () => {
  test('parses --dry-run and does not call setModel', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    await handler('--dry-run openai', ctx);
    assert.equal(setModel.mock.callCount(), 0);
    assert.ok(notify.mock.callCount() > 0);
  });

  test('unknown-query warns', async (t) => {
    const { ext } = await loadExtension(t);
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    await handler('nonexistent-model-xyzzy', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'warning'));
    assert.equal(setModel.mock.callCount(), 0);
  });

  test('usage unavailable → error notification', async (t) => {
    const { ext } = await loadExtension(t, { usage: { codex: new Error('no usage data') } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t, { model: { provider: 'openai' } });
    await handler('openai', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'error'));
  });

  test('success notifies confirmation and calls setModel', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE, codex: CODEX_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    await handler('openai', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'info' && c.arguments[0].includes('Switched')));
    assert.ok(setModel.mock.callCount() >= 1);
  });

  test('ignores models without configured auth', async (t) => {
    const { ext } = await loadExtension(t);
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t, { available: TEST_MODELS.filter(m => m.provider === 'openai') });
    await handler('claude-sonnet-4-20250514', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'warning'));
    assert.equal(setModel.mock.callCount(), 0);
  });

  test('emits progress notification', async (t) => {
    const { ext } = await loadExtension(t, { exec: {}, usage: { claude: CLAUDE_USAGE_STATE, codex: CODEX_USAGE_STATE } });
    const setModel = t.mock.fn(async () => true);
    const handler = ext.createSwitchCommandHandler(makePi(setModel));
    const { notify, ctx } = makeCtx(t);
    await handler('openai', ctx);
    assert.ok(notify.mock.calls.some((c: any) => c.arguments[1] === 'info' && (c.arguments[0].includes('Resolving') || c.arguments[0].includes('Fetching'))));
  });
});
