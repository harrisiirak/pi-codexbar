import type { UsageState, UsageEntry, UsageWindow } from './usage.ts';
import { getProviderUsageState } from './usage.ts';
import { loadSettings, color, bold, stripAnsi } from './settings.ts';
import type { ColorSettings } from './settings.ts';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

interface TokenValues {
  provider: string;
  plan: string;
  session: string;
  weekly: string;
  monthly: string;
  session_reset: string;
  weekly_reset: string;
  monthly_reset: string;
  credits: string;
}

function windowLabel(w: UsageWindow | null): string {
  if (!w || !w.windowMinutes) {
    return '';
  }
  const mins = w.windowMinutes;
  if (mins >= 43200) {
    return `${Math.round(mins / 43200)}mo`;
  }
  if (mins >= 1440) {
    return `${Math.round(mins / 1440)}d`;
  }
  if (mins < 60) {
    return `${mins}m`;
  }
  return `${Math.round(mins / 60)}h`;
}

function pctText(pct: number | null): string {
  if (pct == null) {
    return '—';
  }
  const rounded = Math.round(pct);
  return `${rounded}%`;
}

function formatWindowColored(label: string, w: UsageWindow | null, normalColor: string, highColor: string, threshold: number): string {
  if (!w) {
    return '';
  }
  const wl = windowLabel(w);
  const tag = wl ? `${label}(${wl})` : label;
  const pct = w.usedPercent;
  const c = (pct != null && pct >= threshold) ? highColor : normalColor;
  return `${color(normalColor, tag + ': ')}${bold(c, pctText(pct))}`;
}

function resetShort(w: UsageWindow | null): string {
  if (!w) {
    return '';
  }
  if (w.resetDescription) {
    return w.resetDescription;
  }
  if (!w.resetsAt) {
    return '';
  }
  try {
    return new Date(w.resetsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return w.resetsAt;
  }
}

function buildColoredTokens(entry: UsageEntry & { status: 'ok' }, colorSettings: ColorSettings): TokenValues {
  const metrics = entry.metrics;
  const highThreshold = colorSettings.highThreshold;
  return {
    provider: bold(colorSettings.provider, entry.providerId),
    plan: metrics.loginMethod ? color(colorSettings.plan, `(${metrics.loginMethod})`) : '',
    session: formatWindowColored('S', metrics.primary, colorSettings.session, colorSettings.sessionHigh, highThreshold),
    weekly: formatWindowColored('W', metrics.secondary, colorSettings.weekly, colorSettings.weeklyHigh, highThreshold),
    monthly: metrics.tertiary ? formatWindowColored('M', metrics.tertiary, colorSettings.monthly, colorSettings.monthlyHigh, highThreshold) : '',
    session_reset: resetShort(metrics.primary) ? color(colorSettings.reset, resetShort(metrics.primary)) : '',
    weekly_reset: resetShort(metrics.secondary) ? color(colorSettings.reset, resetShort(metrics.secondary)) : '',
    monthly_reset: resetShort(metrics.tertiary) ? color(colorSettings.reset, resetShort(metrics.tertiary)) : '',
    credits: metrics.creditsRemaining != null ? bold(colorSettings.credits, `$${metrics.creditsRemaining.toFixed(2)}`) : '',
  };
}

function applyFormat(fmt: string, tokens: TokenValues, coloredSep: string): string {
  let result = fmt;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  const segments = result.split(/[|│]/);
  const nonEmpty = segments.filter(seg => {
    const plain = stripAnsi(seg).trim();
    return plain.length > 0 && plain !== '⏱';
  });
  return nonEmpty.map(s => s.trim()).join(` ${coloredSep} `);
}

export function formatUsageFooter(state: UsageState): string {
  const { footer: footerSettings, colors: colorSettings } = loadSettings();
  const entry = state.entries.find(e => e.providerId === state.selectedProvider) ?? state.entries[0];
  if (!entry) {
    return color(colorSettings.error, 'Usage unavailable');
  }
  if (entry.status === 'error') {
    return `${bold(colorSettings.provider, entry.providerId)} ${color(colorSettings.error, `❌ ${entry.error.message}`)}`;
  }
  return applyFormat(footerSettings.format, buildColoredTokens(entry, colorSettings), color(colorSettings.separator, '│'));
}

export const WIDGET_KEY = 'codexbar-usage';

export function renderWidget(ctx: ExtensionContext, state: UsageState): void {
  const settings = loadSettings();
  const placement = settings.footer.placement ?? 'belowEditor';
  ctx.ui.setWidget(WIDGET_KEY, [` ${formatUsageFooter(state)}`], { placement });
}

export function renderWidgetError(ctx: ExtensionContext): void {
  const placement = loadSettings().footer.placement ?? 'belowEditor';
  ctx.ui.setWidget(WIDGET_KEY, [' codexbar: unavailable'], { placement });
}

export function hideFooter(ctx: ExtensionContext): void {
  const placement = loadSettings().footer.placement ?? 'belowEditor';
  ctx.ui.setWidget(WIDGET_KEY, undefined, { placement });
}

export async function refreshFooter(ctx: ExtensionContext, provider: string | undefined): Promise<UsageState | null> {
  if (!provider) {
    return null;
  }
  try {
    const state = await getProviderUsageState(provider);
    renderWidget(ctx, state);
    return state;
  } catch {
    try {
      renderWidgetError(ctx);
    } catch {}
    return null;
  }
}