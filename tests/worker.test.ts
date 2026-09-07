import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNoArguments } from '../viewer/webmcp';

test('physics worker load, stepping, evaluation and failure protocol', async () => {
  let receive: (value: Record<string, unknown>) => void = () => {};
  const scope = globalThis as unknown as {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (value: Record<string, unknown>) => void;
  };
  scope.onmessage = null;
  scope.postMessage = (value: Record<string, unknown>) => receive(value);
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: scope,
  });
  await import('../viewer/simulation.worker');
  const request = (
    data: unknown,
    finalType: string,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('worker timeout')),
        10000,
      );
      receive = (value) => {
        if (value.type === finalType) {
          clearTimeout(timeout);
          resolve(value);
        } else if (value.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(String(value.message)));
        }
      };
      scope.onmessage!({ data });
    });
  const loaded = await request(
    {
      type: 'load',
      text: readFileSync('machines/starter.machine.json', 'utf8'),
      a: 3,
      b: 1,
    },
    'ready',
  );
  assert.equal(
    (loaded.snapshot as { output: { value: number } }).output.value,
    0,
  );
  const frame = await request({ type: 'advance', steps: 8 }, 'frame');
  assert.equal(frame.phase, 'run');
  const evaluated = await request({ type: 'evaluate' }, 'evaluated');
  assert.equal((evaluated.suite as { successes: number }).successes, 1);
  const failed = await request(
    { type: 'load', text: '{bad', a: 0, b: 0 },
    'error',
  );
  assert.equal(failed.type, 'error');
});

test('optional WebMCP tools reject unexpected inputs', () => {
  assert.doesNotThrow(() => assertNoArguments({}));
  for (const input of [null, [], { expression: '3+1' }, ''])
    assert.throws(() => assertNoArguments(input));
});
