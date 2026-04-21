import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import createPiCodexbarExtension from '../src/extension.ts';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

interface Registrations {
  commands: string[];
  tools: string[];
  events: string[];
  pi: ExtensionAPI;
}

function recordRegistrations(): Registrations {
  const commands: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  const pi = {
    registerCommand: (name: string, _def: unknown) => { commands.push(name); },
    registerTool: (def: { name: string }) => { tools.push(def.name); },
    on: (event: string, _handler: unknown) => { events.push(event); },
    setModel: async () => true,
  } as unknown as ExtensionAPI;
  return { commands, tools, events, pi };
}

describe('createPiCodexbarExtension wiring', () => {
  test('registers the expected commands', () => {
    const r = recordRegistrations();
    createPiCodexbarExtension(r.pi);
    assert.deepEqual(r.commands.sort(), ['codexbar-status', 'codexbar-switch', 'codexbar-toggle']);
  });

  test('registers the codexbar_switch_model tool', () => {
    const r = recordRegistrations();
    createPiCodexbarExtension(r.pi);
    assert.deepEqual(r.tools, ['codexbar_switch_model']);
  });

  test('subscribes to expected events', () => {
    const r = recordRegistrations();
    createPiCodexbarExtension(r.pi);
    assert.deepEqual(r.events.sort(), ['agent_end', 'model_select', 'session_start']);
  });
});
