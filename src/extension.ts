import { formatUsageFooter, renderWidget, refreshFooter } from './ui.ts';
import { stripAnsi } from './settings.ts';
import { mapProviderToCodexbar } from './mappings.ts';
import { getProviderUsageState } from './usage.ts';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';

function getProviderFromCtx(ctx: ExtensionContext): string | undefined {
  const provider = ctx.model?.provider;
  if (!provider) {
    return undefined;
  }
  return mapProviderToCodexbar(provider);
}

export default function createPiCodexbarExtension(pi: ExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    const provider = getProviderFromCtx(ctx);
    refreshFooter(ctx, provider).catch(() => {});
  });

  pi.on('agent_end', async (_event, ctx) => {
    const provider = getProviderFromCtx(ctx);
    refreshFooter(ctx, provider).catch(() => {});
  });

  pi.on('model_select', async (event, ctx) => {
    const provider = event.model?.provider;
    if (typeof provider !== 'string' || !provider.trim()) {
      return;
    }
    refreshFooter(ctx, mapProviderToCodexbar(provider)).catch(() => {});
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