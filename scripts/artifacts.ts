import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const digest = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export async function frozenFiles(): Promise<Record<string, string>> {
  const files = ['package.json', 'package-lock.json'];
  for (const directory of ['simulator', 'evaluator', 'scripts']) {
    for (const file of (await readdir(path.join(root, directory))).sort())
      if (file.endsWith('.ts')) files.push(`${directory}/${file}`);
  }
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (file) => [
          file,
          digest(await readFile(path.join(root, file))),
        ]),
    ),
  );
}

export async function verifyFrozen(): Promise<void> {
  const expected = JSON.parse(
    await readFile(path.join(root, 'protocol.lock.json'), 'utf8'),
  );
  const actual = await frozenFiles();
  if (JSON.stringify(expected.files) !== JSON.stringify(actual))
    throw new Error(
      'Frozen evaluator differs from protocol.lock.json. Do not regenerate the lock during an experiment. Use the trusted evaluator checkout.',
    );
}

export async function provenance(machineText: string) {
  let gitCommit = 'uncommitted';
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* A first local run can precede the initial commit. */
  }
  return {
    timestamp: new Date().toISOString(),
    machineSha256: digest(machineText),
    gitCommit,
    evaluatorSha256: digest(JSON.stringify(await frozenFiles())),
    lockfileSha256: digest(
      await readFile(path.join(root, 'package-lock.json')),
    ),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  };
}

export async function writeArtifact(file: string, data: unknown) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}
