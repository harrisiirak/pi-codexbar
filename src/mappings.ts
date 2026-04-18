import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXT_DIR = 'pi-codexbar';
const GLOBAL_DIR = join(homedir(), '.pi', 'agent', 'extensions', EXT_DIR);
const localDir = () => join(process.cwd(), '.pi', 'extensions', EXT_DIR);

function loadJson(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

let cached: Record<string, string> | null = null;

export function resetProviderMappingsCache(): void { cached = null; }

/**
 * Load provider mappings with 3-layer merge (last wins):
 * 1. Bundled (package root provider-mappings.json)
 * 2. Global user (~/.pi/agent/extensions/pi-codexbar/provider-mappings.json)
 * 3. Project-local (<cwd>/.pi/extensions/pi-codexbar/provider-mappings.json)
 */
export function loadProviderMappings(): Record<string, string> {
  if (cached) {
    return cached;
  }
  const bundled = loadJson(join(__dirname, '..', 'provider-mappings.json'));
  const globalUser = loadJson(join(GLOBAL_DIR, 'provider-mappings.json'));
  const projectLocal = loadJson(join(localDir(), 'provider-mappings.json'));
  cached = { ...bundled, ...globalUser, ...projectLocal };
  return cached;
}

export function mapProviderToCodexbar(piProvider: string): string {
  const mappings = loadProviderMappings();
  const lower = piProvider.toLowerCase().trim();
  const exactMatch = mappings[lower];
  if (exactMatch) {
    return exactMatch;
  }
  for (const [piName, cbName] of Object.entries(mappings)) {
    if (lower.startsWith(piName + '-') || lower.startsWith(piName)) {
      return cbName;
    }
  }
  return lower;
}
