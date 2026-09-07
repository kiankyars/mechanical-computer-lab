import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseMachine } from '../simulator/schema';
import { runTrial } from '../evaluator/evaluate';
import { provenance, verifyFrozen, writeArtifact } from './artifacts';

const { values } = parseArgs({
  options: {
    machine: { type: 'string', default: 'machines/starter.machine.json' },
    a: { type: 'string', default: '3' },
    b: { type: 'string', default: '1' },
    out: { type: 'string' },
  },
});
await verifyFrozen();
const text = await readFile(values.machine!, 'utf8');
const trial = await runTrial(
  parseMachine(text),
  Number(values.a),
  Number(values.b),
  undefined,
  undefined,
  8,
);
const out = values.out ?? `results/trace-${Date.now()}.json`;
await writeArtifact(out, { provenance: await provenance(text), trial });
console.log(
  `${trial.reason}: observed ${trial.observed}, expected ${trial.expected}. Saved ${out}`,
);
