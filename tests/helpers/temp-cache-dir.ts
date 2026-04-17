import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';

export async function createTempCacheDir(prefix = 'pi-codexbar-test-') {
  const base = join(tmpdir(), `${prefix}${randomUUID()}`);
  await mkdir(base, { recursive: true });

  return {
    path: base,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
