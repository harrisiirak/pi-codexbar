import { getProviderState, setProvider, type ProviderState } from './provider-state.ts';

// Minimal Pi ExtensionAPI interface — the real object is passed at runtime.
interface PiAPI {
  registerCommand(name: string, handler: (ctx: { args: string[] }) => Promise<string | void>): void;
  setFooter(text: string): void;
}

function formatStatus(state: ProviderState): string {
  const selected = state.providers.find(p => p.id === state.selectedId);
  return selected ? `${selected.label} (${state.providers.filter(p => p.enabled).length} enabled)` : 'unknown';
}

export default function piCodexbarExtension(pi: PiAPI) {
  // Register slash command: /codexbar-status
  pi.registerCommand('codexbar-status', async () => {
    const state = await getProviderState();
    return `Selected: ${formatStatus(state)}`;
  });

  // Register slash command: /codexbar-toggle
  pi.registerCommand('codexbar-toggle', async () => {
    const state = await getProviderState();
    const enabled = state.providers.filter(p => p.enabled);
    const currentIndex = enabled.findIndex(p => p.id === state.selectedId);
    const next = enabled[(currentIndex + 1) % enabled.length];
    if (!next || enabled.length < 2) return 'No other enabled provider to toggle to.';
    await setProvider(next.id);
    return `Switched to ${next.label}`;
  });

  // Footer shows current provider
  getProviderState().then(state => {
    pi.setFooter(`codexbar: ${formatStatus(state)}`);
  }).catch(() => {
    pi.setFooter('codexbar: not found');
  });
}

// Re-export core functions for Plan 2 and external use
export { getProviderState, setProvider } from './provider-state.ts';
export type { ProviderId, Provider, ProviderState } from './provider-state.ts';
