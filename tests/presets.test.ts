import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateSuite } from '../evaluator/evaluate';
import { parseMachine } from '../simulator/schema';
import { CATALOG } from '../app/lib/catalog';

// The gallery must not overclaim: a preset presented as an adder (and made
// the page default, autoplaying) has to actually add.
test('bundled presets presented as adders score 16/16 nominal', async () => {
  for (const entry of CATALOG) {
    const path = `machines/${entry.file}`;
    if (!existsSync(path)) continue;
    const machine = parseMachine(readFileSync(path, 'utf8'));
    if (entry.role !== 'adder') {
      assert.ok(entry.note, `${entry.id}: a non-adder preset needs a note`);
      continue;
    }
    const suite = await evaluateSuite(machine);
    assert.equal(
      suite.successes,
      16,
      `${entry.id} is presented as an adder but scores ${suite.successes}/16`,
    );
  }
});
