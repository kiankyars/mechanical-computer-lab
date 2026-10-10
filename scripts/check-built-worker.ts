import { Worker } from 'node:worker_threads';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from './artifacts';

const directory = path.join(root, 'dist/assets');
const file = (await readdir(directory).catch((): string[] => [])).find((name) =>
  /^simulation\.worker-.*\.js$/.test(name),
);
if (!file) throw new Error('Build the viewer first: npm run build');
const worker = new Worker(
  `
  import { parentPort } from 'node:worker_threads';
  globalThis.self = globalThis;
  globalThis.postMessage = message => parentPort.postMessage(message);
  await import(${JSON.stringify(pathToFileURL(path.join(directory, file)).href)});
  parentPort.on('message', data => globalThis.onmessage({ data }));
  parentPort.postMessage({ type: 'boot' });
`,
  { eval: true, execArgv: ['--input-type=module'] },
);

function waitFor(type: string, ms = 10000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, ms);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (message: Record<string, unknown>) => {
      if (message.type === 'error') {
        cleanup();
        reject(new Error(String(message.message)));
      } else if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('error', onError);
      worker.off('message', onMessage);
    };
    worker.on('error', onError);
    worker.on('message', onMessage);
  });
}
try {
  await waitFor('boot');
  const ready = waitFor('ready');
  worker.postMessage({
    type: 'load',
    text: await readFile(
      path.join(root, 'machines/starter.machine.json'),
      'utf8',
    ),
    a: 3,
    b: 1,
  });
  assert.equal(
    ((await ready).snapshot as { output: { value: number } }).output.value,
    0,
  );
  const evaluated = waitFor('evaluated');
  worker.postMessage({ type: 'evaluate' });
  assert.equal(((await evaluated).suite as { successes: number }).successes, 1);
  const stressed = waitFor('stressed', 120000);
  worker.postMessage({ type: 'stress', seeds: [17, 29] });
  const summary = (await stressed).summary as {
    accepted: boolean;
    suites: { successes: number }[];
  };
  assert.equal(summary.suites.length, 8);
  assert.ok(summary.suites.every((suite) => suite.successes === 1));
  assert.equal(summary.accepted, false);
  console.log(
    'Production worker bundle loaded, scored all 16 inputs correctly (starter: 1/16) and ran the 8-suite development stress profile (not accepted, as expected). This is not visual browser QA.',
  );
} finally {
  await worker.terminate();
}
