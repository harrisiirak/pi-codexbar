import { cli } from './codexbar.ts';
import { readFile, writeFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { loadProviderMappings } from './mappings.ts';

const USAGE_CACHE_TTL_MS = 60_000;
const EXT_DIR = 'pi-codexbar';
const DEFAULT_CACHE_DIR = join(homedir(), '.pi', 'agent', 'extensions', EXT_DIR, '.cache');

export type UsageErrorKind = 'auth' | 'session' | 'provider' | 'unknown';

export interface UsageWindow {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
  resetDescription: string | null;
}

export interface UsageMetrics {
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  tertiary: UsageWindow | null;
  creditsRemaining: number | null;
  loginMethod: string | null;
  updatedAt: string | null;
}

export type UsageEntry =
  | { providerId: string; status: 'ok'; metrics: UsageMetrics }
  | { providerId: string; status: 'error'; error: { kind: UsageErrorKind; message: string } };

export interface UsageState {
  selectedProvider: string;
  entries: UsageEntry[];
  fetchedAt: number;
}

interface RawUsageWindow {
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: string;
  resetDescription?: string;
}

interface RawUsageMetrics {
  primary?: RawUsageWindow | null;
  secondary?: RawUsageWindow | null;
  tertiary?: RawUsageWindow | null;
  creditsRemaining?: number;
  loginMethod?: string;
  updatedAt?: string;
}

interface RawProviderEntry {
  provider?: string;
  id?: string;
  error?: { message?: string };
  usage?: RawUsageMetrics;
}

interface RawAllResponse {
  selectedProvider?: string;
  activeProvider?: string;
  providers?: RawProviderEntry[];
}

type RawUsageResponse = RawProviderEntry[] | RawAllResponse;

export function isKnownProvider(providerId?: string): providerId is string {
  if (typeof providerId !== 'string' || providerId.trim().length === 0 || providerId === 'unknown') {
    return false;
  }
  const mappings = loadProviderMappings();
  // A provider is known if it appears in the mappings (as a key or a value)
  const lower = providerId.toLowerCase().trim();
  if (lower in mappings) {
    return true;
  }
  // Also check if any mapping value matches
  for (const val of Object.values(mappings)) {
    if (val.toLowerCase() === lower) {
      return true;
    }
  }
  return false;
}

export function selectUsageCommand(provider?: string): readonly string[] {
  if (isKnownProvider(provider)) {
    return ['usage', '--provider', provider, '--format', 'json'] as const;
  }
  return ['usage', '--provider', 'all', '--json'] as const;
}

export function classifyError(message: string): UsageErrorKind {
  const m = message.toLowerCase();
  if (m.includes('auth') || m.includes('login') || m.includes('token') || m.includes('logged')) {
    return 'auth';
  }
  if (m.includes('session')) {
    return 'session';
  }
  if (m.includes('provider')) {
    return 'provider';
  }
  return 'unknown';
}

function providerCacheKey(provider?: string): string {
  return isKnownProvider(provider) ? provider! : 'all';
}

function getCacheDir(): string {
  return DEFAULT_CACHE_DIR;
}

function usageCachePath(cacheDir: string, providerKey: string): string {
  return join(cacheDir, `provider-usage-${providerKey}.json`);
}

async function readUsageCache(cacheDir: string, providerKey: string): Promise<UsageState | null> {
  try {
    const raw = await readFile(usageCachePath(cacheDir, providerKey), 'utf-8');
    const cached = JSON.parse(raw) as UsageState;
    if (Date.now() - cached.fetchedAt < USAGE_CACHE_TTL_MS) {
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeUsageCache(cacheDir: string, state: UsageState, providerKey: string): Promise<void> {
  const filePath = usageCachePath(cacheDir, providerKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state), 'utf-8');
}

export async function invalidateUsageCache(): Promise<void> {
  const cacheDirPath = getCacheDir();
  try {
    const files = await readdir(cacheDirPath);
    await Promise.all(
      files.filter(f => f.startsWith('provider-usage-')).map(f => unlink(join(cacheDirPath, f))),
    );
  } catch {
    // directory doesn't exist or empty — nothing to invalidate
  }
}

function toWindow(raw: RawUsageWindow | null | undefined): UsageWindow | null {
  if (!raw) {
    return null;
  }
  return {
    usedPercent: typeof raw.usedPercent === 'number' ? raw.usedPercent : null,
    windowMinutes: typeof raw.windowMinutes === 'number' ? raw.windowMinutes : null,
    resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
    resetDescription: typeof raw.resetDescription === 'string' ? raw.resetDescription : null,
  };
}

function toMetrics(raw: RawProviderEntry): UsageMetrics {
  const usage = raw.usage ?? {};
  return {
    primary: toWindow(usage.primary),
    secondary: toWindow(usage.secondary),
    tertiary: toWindow(usage.tertiary),
    creditsRemaining: typeof usage.creditsRemaining === 'number' ? usage.creditsRemaining : null,
    loginMethod: typeof usage.loginMethod === 'string' ? usage.loginMethod : null,
    updatedAt: typeof usage.updatedAt === 'string' ? usage.updatedAt : null,
  };
}

function toEntry(raw: RawProviderEntry): UsageEntry {
  const providerId = String(raw.provider ?? raw.id ?? 'unknown');
  const entryError = raw.error;
  if (entryError && typeof entryError.message === 'string') {
    return {
      providerId,
      status: 'error',
      error: { kind: classifyError(entryError.message), message: entryError.message },
    };
  }
  return { providerId, status: 'ok', metrics: toMetrics(raw) };
}

function toSelectedProvider(raw: RawAllResponse, entries: UsageEntry[]): string {
  return String(raw.selectedProvider ?? raw.activeProvider ?? (entries[0]?.providerId ?? 'unknown'));
}

function extractProviderRecords(raw: RawUsageResponse): RawProviderEntry[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw.providers)) {
    return raw.providers;
  }
  return [];
}

export async function getProviderUsageState(provider: string): Promise<UsageState> {
  const cacheDir = getCacheDir();
  const providerKey = providerCacheKey(provider);

  const cached = await readUsageCache(cacheDir, providerKey);
  if (cached) {
    return cached;
  }

  const bin = cli.discoverBinary();
  const args = selectUsageCommand(provider);
  const raw = await cli.exec<RawUsageResponse>(bin, [...args], { json: true });
  const rawProviders = extractProviderRecords(raw);
  const entries = rawProviders.map(toEntry);

  const rawObj: RawAllResponse = Array.isArray(raw) ? {} : raw;
  const state: UsageState = {
    entries,
    selectedProvider: toSelectedProvider(rawObj, entries),
    fetchedAt: Date.now(),
  };

  await writeUsageCache(cacheDir, state, providerKey);
  return state;
}

