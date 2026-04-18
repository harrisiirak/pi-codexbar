import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface FooterSettings {
  format: string;
  placement: 'belowEditor' | 'aboveEditor';
}

export interface ColorSettings {
  provider: string;
  plan: string;
  session: string;
  sessionHigh: string;
  weekly: string;
  weeklyHigh: string;
  monthly: string;
  monthlyHigh: string;
  reset: string;
  separator: string;
  credits: string;
  error: string;
  highThreshold: number;
}

export interface CodexBarSettings {
  enabled: boolean;
  footer: FooterSettings;
  colors: ColorSettings;
}

const DEFAULT_SETTINGS: CodexBarSettings = {
  enabled: true,
  footer: {
    format: '{provider} {plan} │ {session} │ {weekly}{monthly} │ {credits} │ ⏱ {session_reset}',
    placement: 'belowEditor',
  },
  colors: {
    provider: '#d787af',
    plan: '#808080',
    session: '#5faf5f',
    sessionHigh: '#ff5f5f',
    weekly: '#00afaf',
    weeklyHigh: '#ff8700',
    monthly: '#af87d7',
    monthlyHigh: '#ff5f5f',
    reset: '#808080',
    separator: '#4e4e4e',
    credits: '#febc38',
    error: '#ff5f5f',
    highThreshold: 80,
  },
};

const EXT_DIR = 'pi-codexbar';
const globalSettings = () => join(homedir(), '.pi', 'agent', 'extensions', EXT_DIR, 'settings.json');
const localSettings = () => join(process.cwd(), '.pi', 'extensions', EXT_DIR, 'settings.json');

export function userSettingsPath(): string {
  return globalSettings();
}

function loadJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

let cachedSettings: CodexBarSettings | null = null;

export function resetSettingsCache(): void {
  cachedSettings = null;
}

export function updateSetting<K extends keyof CodexBarSettings>(key: K, value: CodexBarSettings[K]): void {
  const path = globalSettings();
  const existing = loadJson(path);
  const next = { ...existing, [key]: value };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  resetSettingsCache();
}

export function loadSettings(): CodexBarSettings {
  if (cachedSettings) {
    return cachedSettings;
  }
  const bundled = loadJson(join(__dirname, '..', 'settings.json'));
  const global = loadJson(globalSettings());
  const local = loadJson(localSettings());
  const pickEnabled = (src: Record<string, unknown>): boolean | undefined =>
    typeof src.enabled === 'boolean' ? src.enabled : undefined;
  cachedSettings = {
    enabled: pickEnabled(local) ?? pickEnabled(global) ?? pickEnabled(bundled) ?? DEFAULT_SETTINGS.enabled,
    footer: { ...DEFAULT_SETTINGS.footer, ...(bundled.footer as object ?? {}), ...(global.footer as object ?? {}), ...(local.footer as object ?? {}) } as FooterSettings,
    colors: { ...DEFAULT_SETTINGS.colors, ...(bundled.colors as object ?? {}), ...(global.colors as object ?? {}), ...(local.colors as object ?? {}) } as ColorSettings,
  };
  return cachedSettings;
}

function hexToAnsi(hex: string): string {
  if (!hex || !hex.startsWith('#')) {
    return '';
  }
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RST = '\x1b[0m';
const BLD = '\x1b[1m';

export function color(hex: string, text: string): string {
  const code = hexToAnsi(hex);
  return code ? `${code}${text}${RST}` : text;
}

export function bold(hex: string, text: string): string {
  const code = hexToAnsi(hex);
  return code ? `${BLD}${code}${text}${RST}` : text;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
