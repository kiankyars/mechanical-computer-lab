import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateSuite, scoreWindow } from '../evaluator/evaluate';
import { readGauges } from '../simulator/readout';
import { parseMachine } from '../simulator/schema';
import { caseOrder, conditionsForSeed } from '../evaluator/conditions';
import { validateConditions } from '../simulator/protocol';

const reading = (offsets: number[], speed = 0) =>
  readGauges(offsets.map((x) => ({ x: 8 + x, speed })));
test('fixed output gauges decode bits, including 100', () => {
  assert.equal(reading([0, 0, 1]).value, 4);
  assert.equal(reading([1, 1, 0]).binary, '011');
  assert.equal(reading([0.5, 0, 0]).value, null);
  assert.equal(reading([NaN, 0, 0]).value, null);
  assert.equal(reading([2, 0, 0]).value, null);
});
test('entire read window must be stable, complete and slow', () => {
  const good = reading([0, 0, 1]);
  assert.equal(scoreWindow([good, good], 4, 2).passed, true);
  assert.equal(scoreWindow([good, reading([0, 1, 1])], 4, 2).passed, false);
  assert.equal(scoreWindow([good, reading([0, 0, 1], 1)], 4, 2).passed, false);
  assert.equal(scoreWindow([good], 4, 2).passed, false);
});
test('empty candidate cannot exploit the evaluator', async () => {
  const machine = parseMachine(
    readFileSync('machines/starter.machine.json', 'utf8'),
  );
  const report = await evaluateSuite(machine);
  assert.equal(report.total, 16);
  assert.equal(report.successes, 1);
  assert.equal(report.successRate, 1 / 16);
  assert(
    report.trials.filter((t) => t.a !== 0 || t.b !== 0).every((t) => !t.passed),
  );
});
test('seeds are repeatable and case permutations cover all16', () => {
  assert.deepEqual(conditionsForSeed(17), conditionsForSeed(17));
  assert.notDeepEqual(conditionsForSeed(17), conditionsForSeed(29));
  for (let seed = 0; seed < 100; seed++) {
    validateConditions(conditionsForSeed(seed));
    assert.equal(new Set(caseOrder(seed).map((x) => x.join(','))).size, 16);
  }
});
