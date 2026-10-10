import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Message = Record<string, unknown>;

test('worker stress profile mirrors the CLI development profile', async () => {
  const messages: Message[] = [];
  let settle: (value: Message) => void = () => {};
  const scope = globalThis as unknown as {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (value: Message) => void;
  };
  scope.onmessage = null;
  scope.postMessage = (value: Message) => {
    messages.push(value);
    if (['prepared', 'stressed', 'error'].includes(String(value.type)))
      settle(value);
  };
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: scope,
  });
  await import('../viewer/simulation.worker');
  const send = (data: unknown) =>
    new Promise<Message>((resolve) => {
      settle = resolve;
      scope.onmessage!({ data });
    });

  const prepared = await send({
    type: 'prepare',
    text: readFileSync('machines/starter.machine.json', 'utf8'),
  });
  assert.equal(prepared.type, 'prepared');

  const done = await send({ type: 'stress', seeds: [17, 29] });
  assert.equal(done.type, 'stressed', String(done.message));
  const summary = done.summary as {
    accepted: boolean;
    suites: {
      label: string;
      mode: string;
      successes: number;
      total: number;
      resetFailures: number;
      trials: Message[];
    }[];
  };
  assert.deepEqual(
    summary.suites.map((s) => `${s.label}/${s.mode}`),
    [
      'nominal/fresh',
      'nominal/persistent',
      'perturbed-17/fresh',
      'perturbed-17/persistent',
      'perturbed-29/fresh',
      'perturbed-29/persistent',
      'half-timestep/fresh',
      'half-timestep/persistent',
    ],
  );
  // The empty starter is only correct for 0 + 0, in every configuration.
  for (const suite of summary.suites) {
    assert.equal(suite.successes, 1);
    assert.equal(suite.total, 16);
    assert.equal(suite.trials.length, 16);
    for (const trial of suite.trials) {
      assert.equal('trace' in trial, false);
      assert.equal('final' in trial, false);
    }
  }
  assert.equal(summary.accepted, false);
  const progress = messages.filter((m) => m.type === 'stress-progress');
  assert.equal(progress.length, 8 * 16);

  const bad = await send({ type: 'stress', seeds: [17] });
  assert.equal(bad.type, 'error');
});
