import { join } from 'node:path';
import { writeFile, chmod, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function createFakeCodexbar(responses: Record<string, string>) {
  const dir = join(tmpdir(), `fake-codexbar-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const binPath = join(dir, 'codexbar');

  const cases = Object.entries(responses)
    .map(([args, output]) => `  "${args}") echo '${output.replace(/'/g, "'\\''")}' ;;`)
    .join('\n');

  const script = `#!/bin/sh
case "$*" in
${cases}
  *) echo "unknown command: $*" >&2; exit 1 ;;
esac
`;

  await writeFile(binPath, script, 'utf-8');
  await chmod(binPath, 0o755);

  return {
    binPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
