import { test, describe, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from '@mariozechner/pi-coding-agent';

type ExtModule = typeof import('../src/extension.ts');
type UIOverrides = {
  refreshFooter?: (...args: any[]) => any;
  formatUsageFooter?: (...args: any[]) => any;
  renderWidget?: (...args: any[]) => any;
  hideFooter?: (...args: any[]) => any;
};

async function reloadModule<T>(t: TestContext, spec: string): Promise<T> {
  const fresh = await import(`${spec}?bust=${Math.random()}`);
  t.mock.module(spec, { namedExports: fresh });
  return fresh as T;
}

async function loadExtension(t: TestContext, opts: { ui?: UIOverrides } = {}): Promise<ExtModule> {
  if (opts.ui) {
    t.mock.module('../src/ui.ts', {
      namedExports: {
        refreshFooter: opts.ui.refreshFooter ?? t.mock.fn(() => Promise.resolve(null)),
        formatUsageFooter: opts.ui.formatUsageFooter ?? mock.fn(() => 'mocked'),
        renderWidget: opts.ui.renderWidget ?? mock.fn(),
        hideFooter: opts.ui.hideFooter ?? mock.fn(),
      },
    });
  } else {
    await reloadModule(t, '../src/ui.ts');
  }

  return (await import(`../src/extension.ts?bust=${Math.random()}`)) as ExtModule;
}

interface Registrations {
  commands: string[];
  tools: string[];
  events: string[];
  providers: Array<{ name: string; config: unknown }>;
  pi: ExtensionAPI;
  handlers: Map<string, (...args: any[]) => any>;
}

function recordRegistrations(): Registrations {
  const commands: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  const providers: Array<{ name: string; config: unknown }> = [];
  const handlers = new Map<string, (...args: any[]) => any>();
  const pi = {
    registerCommand: (name: string, _def: unknown) => { commands.push(name); },
    registerTool: (def: { name: string }) => { tools.push(def.name); },
    on: (event: string, handler: unknown) => { events.push(event); handlers.set(event, handler as any); },
    registerProvider: (name: string, config: unknown) => { providers.push({ name, config }); },
    setModel: async () => true,
  } as unknown as ExtensionAPI;
  return { commands, tools, events, providers, pi, handlers };
}

describe('createPiCodexbarExtension wiring', () => {
  test('registers the expected commands', async (t) => {
    const r = recordRegistrations();
    const ext = await loadExtension(t);
    ext.default(r.pi);
    assert.deepEqual(r.commands.sort(), ['codexbar-status', 'codexbar-switch', 'codexbar-toggle']);
  });

  test('registers the codexbar_switch_model tool', async (t) => {
    const r = recordRegistrations();
    const ext = await loadExtension(t);
    ext.default(r.pi);
    assert.deepEqual(r.tools, ['codexbar_switch_model']);
  });

  test('subscribes to expected events', async (t) => {
    const r = recordRegistrations();
    const ext = await loadExtension(t);
    ext.default(r.pi);
    assert.deepEqual(r.events.sort(), ['agent_end', 'model_select', 'session_start']);
  });

  test('registers codexbar provider on startup', async (t) => {
    const r = recordRegistrations();
    const ext = await loadExtension(t);
    ext.default(r.pi);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(r.providers.length, 1, 'expected exactly one provider registration');
    assert.equal(r.providers[0].name, 'codexbar');
    assert.ok(
      r.providers[0].config &&
      typeof r.providers[0].config === 'object' &&
      Array.isArray((r.providers[0].config as Record<string, unknown>).models),
      'expected config to contain a models array',
    );
    const models = (r.providers[0].config as Record<string, unknown>).models as Array<{ id: string }>;
    assert.ok(models.length > 0, 'expected at least one model');
    const ids = models.map(m => m.id);
    assert.ok(ids.includes('cheap'), 'expected built-in cheap alias');
    assert.ok(ids.includes('vision'), 'expected built-in vision alias');
    assert.ok(ids.includes('reasoning'), 'expected built-in reasoning alias');
    assert.ok(ids.includes('long-context'), 'expected built-in long-context alias');
  });

  test('registers codexbar provider with required SDK contract fields', async (t) => {
    const r = recordRegistrations();
    const ext = await loadExtension(t);
    ext.default(r.pi);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(r.providers.length, 1, 'expected exactly one provider registration');

    const config = r.providers[0].config as Record<string, unknown>;

    // SDK requires baseUrl when models are defined
    assert.ok(
      config.baseUrl && typeof config.baseUrl === 'string',
      'expected config.baseUrl to be a non-empty string (required by SDK when models are defined)',
    );

    // SDK requires apiKey or oauth when models are defined
    const hasApiKey = config.apiKey && typeof config.apiKey === 'string';
    const hasOauth = config.oauth && typeof config.oauth === 'object';
    assert.ok(
      hasApiKey || hasOauth,
      'expected config.apiKey or config.oauth to be present (required by SDK when models are defined)',
    );
  });

  test('re-registers codexbar provider on session_start and refreshes footer', async (t) => {
    const ext = await loadExtension(t, { ui: {} });
    const r = recordRegistrations();
    ext.default(r.pi);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(r.providers.length, 1, 'expected one provider registration after startup');

    const sessionStartHandler = r.handlers.get('session_start');
    assert.ok(sessionStartHandler, 'expected session_start handler to be registered');

    const stubEvent = {} as SessionStartEvent;
    const stubCtx = {
      model: { provider: 'openai' },
      ui: { notify: () => {}, setFooter: () => {} },
      modelRegistry: { getAvailable: () => [] },
    } as unknown as ExtensionContext;

    await sessionStartHandler(stubEvent, stubCtx);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(r.providers.length, 2, 'expected two provider registrations after session_start');
    assert.equal(r.providers[1].name, 'codexbar');
  });

  test('session_start handler still runs footer refresh behavior', async (t) => {
    const refreshFooterMock = t.mock.fn(() => Promise.resolve(null));
    const ext = await loadExtension(t, { ui: { refreshFooter: refreshFooterMock } });
    const r = recordRegistrations();
    ext.default(r.pi);

    const sessionStartHandler = r.handlers.get('session_start');
    assert.ok(sessionStartHandler, 'expected session_start handler to be registered');

    const stubEvent = {} as SessionStartEvent;
    const stubCtx = {
      model: { provider: 'openai' },
      ui: { notify: () => {}, setFooter: () => {} },
      modelRegistry: { getAvailable: () => [] },
    } as unknown as ExtensionContext;

    await sessionStartHandler(stubEvent, stubCtx);
    assert.equal(refreshFooterMock.mock.callCount(), 1, 'expected refreshFooter to be called once');
  });
});
