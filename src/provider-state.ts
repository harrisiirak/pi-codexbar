import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { discoverBinary, runJson, run } from './codexbar.ts';

export type ProviderId = string;

export interface Provider {
  id: ProviderId;
  label: string;
  enabled: boolean;
}

export interface ProviderState {
  providers: Provider[];
  selectedId: ProviderId;
  fetchedAt: number;
}

interface RawProvider { id: string; name: string; active: boolean }
interface RawPayload { providers: RawProvider[]; active_provider: string }

function normalize(raw: RawPayload): ProviderState {
  return {
    providers: raw.providers.map(p => ({
      id: p.id,
      label: p.name,
      enabled: p.active,
    })),
    selectedId: raw.active_provider,
    fetchedAt: Date.now(),
  };
}

const CACHE_FILE = '.pi-cache/provider-state.json';
const CACHE_TTL_MS = 15_000;

function cachePath(baseDir: string): string {
  return join(baseDir, CACHE_FILE);
}

async function readCache(baseDir: string): Promise<ProviderState | null> {
  try {
    const raw = await readFile(cachePath(baseDir), 'utf-8');
    const parsed = JSON.parse(raw) as ProviderState;
    if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed;
  } catch {}
  return null;
}

async function writeCache(baseDir: string, state: ProviderState): Promise<void> {
  const path = cachePath(baseDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state), 'utf-8');
}

async function clearCache(baseDir: string): Promise<void> {
  try { await unlink(cachePath(baseDir)); } catch {}
}

export async function getProviderState(binaryPath?: string, cacheDir?: string): Promise<ProviderState> {
  const dir = cacheDir ?? process.cwd();
  const cached = await readCache(dir);
  if (cached) return cached;

  const bin = binaryPath ?? discoverBinary();
  const raw = await runJson<RawPayload>(bin, ['provider', 'list', '--json']);
  const state = normalize(raw);
  await writeCache(dir, state);
  return state;
}

export async function setProvider(providerId: ProviderId, binaryPath?: string, cacheDir?: string): Promise<void> {
  const bin = binaryPath ?? discoverBinary();
  const dir = cacheDir ?? process.cwd();
  await run(bin, ['provider', 'switch', providerId]);
  await clearCache(dir);
}
