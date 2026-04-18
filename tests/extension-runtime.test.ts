import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import createPiCodexbarExtension from '../src/extension.ts';
import { mockExec } from './helpers/mock-exec.ts';
import { stripAnsi, resetSettingsCache, userSettingsPath } from '../src/settings.ts';

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

function createFakePi(modelProvider?: string) {
  const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>();
  const events = new Map<string, EventHandler>();
  const notifications: Array<{ message: string; level: string }> = [];
  const widgets = new Map<string, { content: Function | string[] | undefined; options: any }>();

  const fakeCtx = {
    model: modelProvider ? { provider: modelProvider } : undefined,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
      setStatus(_key: string, _value: string | undefined) {},
      setWidget(name: string, content: Function | string[] | undefined, options?: any) { widgets.set(name, { content, options }); },
    },
  };

  return {
    pi: {
      registerCommand(name: string, def: any) { commands.set(name, def); },
      on(event: string, handler: EventHandler) { events.set(event, handler); },
    },
    callCommand: async (name: string, args = '') => { await commands.get(name)?.handler(args, fakeCtx); },
    emitEvent: async (name: string, event: any = {}) => { await events.get(name)?.(event, fakeCtx); },
    getCommandNames: () => [...commands.keys()],
    getNotifications: () => [...notifications],
    renderWidget: (name: string): string[] => {
      const widget = widgets.get(name);
      if (!widget || widget.content == null) {
        return [];
      }
      if (Array.isArray(widget.content)) {
        return widget.content;
      }
      return widget.content().render(120);
    },
    hasWidget: (name: string) => widgets.has(name),
    getWidgetPlacement: (name: string) => widgets.get(name)?.options?.placement,
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

test('registers codexbar-toggle and codexbar-status commands', () => {
  const fakePi = createFakePi();
  createPiCodexbarExtension(fakePi.pi);
  assert.deepEqual(fakePi.getCommandNames().sort(), ['codexbar-status', 'codexbar-toggle']);
});

test('codexbar-toggle disables auto-refresh on events', async (t) => {
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

test('codexbar-toggle clears widget when disabling', async (t) => {
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

test('codexbar-toggle re-enables and re-renders immediately', async (t) => {
  await withTempHome(t);
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const fakePi = createFakePi('claude');
  const cache = tmpCacheDir();
  t.after(async () => { await cache.cleanup(); });

  createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await fakePi.callCommand('codexbar-toggle', ''); // off
  await fakePi.callCommand('codexbar-toggle', ''); // on
  await new Promise(r => setTimeout(r, 500));

  assert.ok(fakePi.renderWidget('codexbar-usage').length > 0);
});

test('codexbar-toggle persists enabled=false to user settings.json', async (t) => {
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

test('persisted enabled=false stays off across extension reloads', async (t) => {
  await withTempHome(t);
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const cache = tmpCacheDir();
  t.after(async () => { await cache.cleanup(); });

  const first = createFakePi('claude');
  createPiCodexbarExtension(first.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await first.callCommand('codexbar-toggle', ''); // persist disabled

  const second = createFakePi('claude');
  createPiCodexbarExtension(second.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await second.emitEvent('agent_end');
  await new Promise(r => setTimeout(r, 200));

  assert.equal(second.renderWidget('codexbar-usage').length, 0);
});

test('toggle merges into existing user settings without clobbering other keys', async (t) => {
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

test('codexbar-status renders colored widget', async (t) => {
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const fakePi = createFakePi('claude');
  const cache = tmpCacheDir();
  t.after(async () => {  await cache.cleanup(); });

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

test('codexbar-status auto-detects from ctx.model', async (t) => {
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const fakePi = createFakePi('claude');
  const cache = tmpCacheDir();
  t.after(async () => {  await cache.cleanup(); });

  createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await fakePi.callCommand('codexbar-status', '');
  assert.ok(fakePi.hasWidget('codexbar-usage'));
});

test('codexbar-status with no provider and no ctx warns', async (t) => {
  const mock = mockExec(t, {});
  const fakePi = createFakePi();
  createPiCodexbarExtension(fakePi.pi);
  await fakePi.callCommand('codexbar-status', '');
  
  assert.equal(fakePi.getNotifications()[0].level, 'warning');
});

test('agent_end auto-refreshes widget', async (t) => {
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const fakePi = createFakePi('claude');
  const cache = tmpCacheDir();
  t.after(async () => {  await cache.cleanup(); });

  createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await fakePi.emitEvent('agent_end');
  await new Promise(r => setTimeout(r, 500));

  assert.ok(fakePi.hasWidget('codexbar-usage'));
});

test('session_start auto-refreshes widget', async (t) => {
  const mock = mockExec(t, { 'usage --provider claude --format json': CLAUDE_PAYLOAD });
  const fakePi = createFakePi('claude');
  const cache = tmpCacheDir();
  t.after(async () => {  await cache.cleanup(); });

  createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await fakePi.emitEvent('session_start');
  await new Promise(r => setTimeout(r, 500));

  assert.ok(fakePi.hasWidget('codexbar-usage'));
});

test('no provider in ctx means no widget on agent_end', async (t) => {
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
  t.after(async () => {  await cache.cleanup(); });

  createPiCodexbarExtension(fakePi.pi, { binaryPath: 'codexbar', cacheDir: cache.dir });
  await fakePi.callCommand('codexbar-status', 'claude');
  assert.equal(fakePi.getWidgetPlacement('codexbar-usage'), 'belowEditor');
});
