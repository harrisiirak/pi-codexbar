import { Type } from '@sinclair/typebox';
import { formatUsageFooter, renderWidget, refreshFooter } from './ui.ts';
import { stripAnsi, loadSettings, updateSetting } from './settings.ts';
import { mapProviderToCodexbar } from './mappings.ts';
import { getProviderUsageState, invalidateUsageCache } from './usage.ts';
import { runSwitch, parseSlashArgs, SwitchRequest } from './switch.ts';
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  SessionStartEvent,
  AgentEndEvent,
  AgentToolResult,
  AgentToolUpdateCallback,
} from '@mariozechner/pi-coding-agent';

type ModelSelectEvent = Extract<ExtensionEvent, { type: 'model_select' }>;

const WIDGET_KEY = 'codexbar-usage';

function getProviderFromCtx(ctx: ExtensionContext): string | undefined {
  const provider = ctx.model?.provider;
  if (!provider) {
    return undefined;
  }
  return mapProviderToCodexbar(provider);
}

export async function handleSessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
  const enabled = loadSettings().enabled;
  if (!enabled) {
    return;
  }
  const provider = getProviderFromCtx(ctx);
  try {
    await refreshFooter(ctx, provider);
  } catch {
    /* ignore */
  }
}

export async function handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<void> {
  const enabled = loadSettings().enabled;
  if (!enabled) {
    return;
  }
  const provider = getProviderFromCtx(ctx);
  try {
    await refreshFooter(ctx, provider);
  } catch {
    /* ignore */
  }
}

export async function handleModelSelect(event: ModelSelectEvent, ctx: ExtensionContext): Promise<void> {
  const enabled = loadSettings().enabled;
  if (!enabled) {
    return;
  }
  const provider = event.model?.provider;
  if (!provider) {
    return;
  }
  try {
    await refreshFooter(ctx, mapProviderToCodexbar(provider));
  } catch {
    /* ignore */
  }
}

export function createSwitchToolExecutor(pi: ExtensionAPI) {
  const textResult = (text: string): AgentToolResult<undefined> => ({ content: [{ type: 'text', text }], details: undefined });
  return async function execute(
    _toolCallId: string,
    params: SwitchRequest,
    _signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<undefined> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<undefined>> {
    try {
      const action = params.action;
      const query = params.query?.trim() || '';
      const excludeProviders = params.excludeProviders ?? [];
      const dryRun = params.dryRun ?? false;

      await invalidateUsageCache();
      const result = await runSwitch({ action, query, excludeProviders, dryRun }, ctx.modelRegistry.getAvailable());

      if (result.kind === 'error') {
        return textResult(`❌ ${result.message}`);
      }

      if (result.kind === 'list') {
        return textResult(result.text);
      }

      if (result.kind === 'preview') {
        return textResult(result.text);
      }

      const winner = result.winner;
      const switched = await pi.setModel(winner);
      if (!switched) {
        return textResult(`❌ Failed to switch to ${winner.provider}/${winner.id} — API key may not be configured.`);
      }
      return textResult(`✅ Switched to ${winner.provider}/${winner.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`❌ Error: ${message}`);
    }
  };
}

export function createSwitchCommandHandler(pi: ExtensionAPI) {
  return async function handler(args: string, ctx: ExtensionContext): Promise<void> {
    const parsed = parseSlashArgs(args ?? '');
    if ('error' in parsed) {
      ctx.ui.notify(`⚠️ ${parsed.error}`, 'warning');
      return;
    }

    const request = {
      action: parsed.action,
      query: parsed.query ?? '',
      excludeProviders: parsed.excludeProviders,
      dryRun: parsed.dryRun,
    };

    ctx.ui.notify('⏳ Resolving candidates...', 'info');

    try {
      await invalidateUsageCache();
      const result = await runSwitch(request, ctx.modelRegistry.getAvailable());

      if (result.kind === 'error') {
        ctx.ui.notify(`⚠️ ${result.message}`, 'warning');
        return;
      }

      if (result.kind === 'list') {
        ctx.ui.notify(result.text.replace('📋', '📊'), 'info');
        return;
      }

      if (result.kind === 'preview') {
        ctx.ui.notify(result.text, 'info');
        return;
      }

      const allUnavailable = result.ordered.length > 0 && result.ordered.every(c => c.error);
      if (allUnavailable) {
        ctx.ui.notify('❌ Usage data unavailable for all candidates — cannot rank reliably', 'error');
        return;
      }

      const winner = result.winner;
      const switched = await pi.setModel(winner);
      if (!switched) {
        ctx.ui.notify(`❌ Failed to switch to ${winner.provider}/${winner.id} — API key may not be configured.`, 'error');
        return;
      }
      ctx.ui.notify(`✅ Switched to ${winner.provider}/${winner.id}`, 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`❌ Error: ${message}`, 'error');
    }
  };
}

export async function handleToggleCommand(args: string, ctx: ExtensionContext): Promise<void> {
  const enabled = loadSettings().enabled === false;
  try {
    updateSetting('enabled', enabled);
  } catch (err: unknown) {
    ctx.ui.notify(`⚠️ Could not persist toggle state: ${(err as Error).message}`, 'warning');
  }
  if (enabled) {
    ctx.ui.notify('CodexBar widget enabled', 'info');
    const provider = getProviderFromCtx(ctx);
    try {
      await refreshFooter(ctx, provider);
    } catch {
      /* ignore */
    }
    return;
  }
  const placement = loadSettings().footer.placement;
  ctx.ui.setWidget(WIDGET_KEY, undefined, { placement });
  ctx.ui.notify('CodexBar widget disabled', 'info');
}

export async function handleStatusCommand(args: string, ctx: ExtensionContext): Promise<void> {
  const explicit = args?.trim();
  const provider = explicit ? mapProviderToCodexbar(explicit) : getProviderFromCtx(ctx);
  if (!provider) {
    ctx.ui.notify('Could not detect provider. Usage: /codexbar-status <provider>\nExamples: claude, codex, copilot', 'warning');
    return;
  }
  try {
    ctx.ui.notify(`⏳ Fetching ${provider} usage...`, 'info');
    const state = await getProviderUsageState(provider);
    renderWidget(ctx, state);
    ctx.ui.notify(`📊 ${stripAnsi(formatUsageFooter(state))}`, 'info');
  } catch (err: unknown) {
    ctx.ui.notify(`❌ Failed to fetch ${provider}: ${(err as Error).message}`, 'error');
  }
}

export default function createPiCodexbarExtension(pi: ExtensionAPI): void {
  pi.on('session_start', handleSessionStart);
  pi.on('agent_end', handleAgentEnd);
  pi.on('model_select', handleModelSelect);
  pi.registerTool({
    name: 'codexbar_switch_model',
    label: 'CodexBar usage-aware model switch',
    description:
      'Resolve candidates and switch to the model with the highest remaining CodexBar usage budget.',
    promptSnippet:
      'Use codexbar_switch_model to list candidates or usage-rank models before switching.',
    promptGuidelines: [
      'Use action="list" first when the user wants to inspect candidates or confirm how a query resolves.',
      'Use dryRun=true for a dry run when you want the ranked budget breakdown without changing the active model.',
      'Pass excludeProviders when the user wants to avoid specific providers during ranking.',
    ],
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal('switch'), Type.Literal('list')],
        {
          description:
            `Action to perform: 'switch' (pick the model with the highest remaining CodexBar budget and switch to it) or 'list' (show resolved candidates without switching). Example: 'list'.`,
        },
      ),
      query: Type.Optional(
        Type.String({
          description:
            `Model selector. Accepts an exact provider/id ('anthropic/claude-opus-4-7'), a provider ('openai'), a full model id ('gpt-5.4'), an alias key ('sonnet', 'coding', 'cheap'), a built-in keyword ('reasoning', 'vision', 'long-context'), or a partial/versioned token match ('opus-4-7', 'gemini-3.1'). Leave empty to use the current provider's models. Examples: 'opus', 'gemini-3.1', 'anthropic/claude-opus-4-7'.`,
        }),
      ),
      excludeProviders: Type.Optional(
        Type.Array(Type.String(), {
          description:
            `Provider ids to exclude from ranking (Pi provider names, not CodexBar ids). Useful when the user wants to avoid a specific route. Example: ['anthropic', 'openai'].`,
        }),
      ),
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            'If true, compute the ranked budget breakdown and return the preview without actually switching the active model. Example: true.',
        }),
      ),
    }),
    execute: createSwitchToolExecutor(pi),
  });
  pi.registerCommand('codexbar-switch', {
    description: 'Switch models ranked by CodexBar usage budget',
    handler: createSwitchCommandHandler(pi),
  });
  pi.registerCommand('codexbar-toggle', {
    description: 'Toggle the CodexBar usage widget on/off (persists to user settings)',
    handler: handleToggleCommand,
  });
  pi.registerCommand('codexbar-status', {
    description: 'Fetch CodexBar usage (usage: /codexbar-status [provider])',
    handler: handleStatusCommand,
  });
}
