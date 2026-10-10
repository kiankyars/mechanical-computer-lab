import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateSuite } from '../evaluator/evaluate';
import { parseMachine } from '../simulator/schema';

// Participant workspaces delete the reference adder (docs/experiment.md), so
// every check here skips when it is absent.
const path = 'machines/reference-adder.machine.json';
const skip = existsSync(path) ? false : 'reference adder withheld';
const text = skip ? '' : readFileSync(path, 'utf8');

// Feasibility witness: the task can be solved inside the frozen protocol.
test(
  'reference adder adds all 16 pairs in fresh and persistent worlds',
  { skip },
  async () => {
    const machine = parseMachine(text);
    const fresh = await evaluateSuite(machine);
    assert.equal(fresh.successes, 16);
    const persistent = await evaluateSuite(machine, { mode: 'persistent' });
    assert.equal(persistent.successes, 16);
    assert.equal(persistent.resetFailures, 0);
  },
);

// The computation must come from the crank, not from released spring preload.
test(
  'reference adder computes nothing when its crank arm is locked',
  { skip },
  async () => {
    const locked = await evaluateSuite(parseMachine(text), {
      intervention: { kind: 'lock', body: 'crank-arm' },
    });
    assert.ok(locked.trials.every((trial) => trial.observed === 0));
  },
);

test(
  'committed reference adder is exactly its generator output',
  { skip },
  async () => {
    const { build, serialize } = await import('../tools/reference-adder');
    assert.equal(text, serialize(build().machine));
  },
);
