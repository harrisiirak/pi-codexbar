import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CANONICAL_DARWIN_PATH = '/usr/local/bin/codexbar';

function whichCodexbar(): string | null {
  try {
    return execSync('which codexbar', { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}

export function discoverCodexbarBinary(
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = existsSync,
  pathLookup: () => string | null = whichCodexbar,
): string {
  if (platform === 'darwin' && fileExists(CANONICAL_DARWIN_PATH)) {
    return CANONICAL_DARWIN_PATH;
  }

  const fromPath = pathLookup();
  if (fromPath) {
    return fromPath;
  }

  throw new Error('codexbar binary not found');
}
