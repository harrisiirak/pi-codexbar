import { formatUsageFooter, renderWidget, refreshFooter } from './ui.ts';
import { stripAnsi, loadSettings, updateSetting } from './settings.ts';
import { mapProviderToCodexbar } from './mappings.ts';
import { getProviderUsageState } from './usage.ts';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';

const WIDGET_KEY = 'codexbar-usage';

function getProviderFromCtx(ctx: ExtensionContext): string | undefined {
  const provider = ctx.model?.provider;
  if (!provider) {
    return undefined;
  }
  return mapProviderToCodexbar(provider);
}

export default function createPiCodexbarExtension(pi: ExtensionAPI): void {
  let enabled = loadSettings().enabled !== false;

  pi.on('session_start', async (_event, ctx) => {
    if (!enabled) return;
    const provider = getProviderFromCtx(ctx);
    refreshFooter(ctx, provider).catch(() => {});
  });

  pi.on('agent_end', async (_event, ctx) => {
    if (!enabled) return;
    const provider = getProviderFromCtx(ctx);
    refreshFooter(ctx, provider).catch(() => {});
  });

  pi.on('model_select', async (event, ctx) => {
    if (!enabled) return;
    const provider = event.model?.provider;
    if (typeof provider !== 'string' || !provider.trim()) {
      return;
    }
    refreshFooter(ctx, mapProviderToCodexbar(provider)).catch(() => {});
  });

  pi.registerCommand('codexbar-toggle', {
    description: 'Toggle the CodexBar usage widget on/off (persists to user settings)',
    handler: async (_args: string, ctx) => {
      enabled = !enabled;
      try {
        updateSetting('enabled', enabled);
      } catch (err: unknown) {
        ctx.ui.notify(`⚠️ Could not persist toggle state: ${(err as Error).message}`, 'warning');
      }
      if (enabled) {
        ctx.ui.notify('CodexBar widget enabled', 'info');
        const provider = getProviderFromCtx(ctx);
        refreshFooter(ctx, provider).catch(() => {});
        return;
      }
      const placement = loadSettings().footer.placement;
      ctx.ui.setWidget(WIDGET_KEY, undefined, { placement });
      ctx.ui.notify('CodexBar widget disabled', 'info');
    },
  });

  pi.registerCommand('codexbar-status', {
    description: 'Fetch CodexBar usage (usage: /codexbar-status [provider])',
    handler: async (args: string, ctx) => {
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
    },
  });
}