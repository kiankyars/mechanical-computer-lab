import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseMachine } from '../simulator/schema';
import { evaluateSuite } from '../evaluator/evaluate';
import { caseOrder, conditionsForSeed } from '../evaluator/conditions';
import { NOMINAL, PROTOCOL_VERSION } from '../simulator/protocol';
import { provenance, verifyFrozen, writeArtifact } from './artifacts';
import type { Intervention } from '../simulator/world';

const { values } = parseArgs({
  options: {
    machine: { type: 'string', default: 'machines/starter.machine.json' },
    profile: { type: 'string', default: 'nominal' },
    seeds: { type: 'string', default: '17,29' },
    out: { type: 'string' },
    remove: { type: 'string' },
    lock: { type: 'string' },
    'require-pass': { type: 'boolean', default: false },
  },
});
if (!['nominal', 'development', 'final'].includes(values.profile!))
  throw new Error('Profile must be nominal, development, or final');
if (values.remove && values.lock)
  throw new Error('Choose one intervention per evaluation');
if (
  values.profile === 'final' &&
  !process.argv.some((v) => v === '--seeds' || v.startsWith('--seeds='))
)
  throw new Error(
    'Final evaluation requires evaluator-owner seeds chosen after candidate submission',
  );
const seeds = values.seeds!.split(',').map(Number);
if (
  !seeds.length ||
  seeds.length > 32 ||
  !seeds.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffffffff) ||
  new Set(seeds).size !== seeds.length
)
  throw new Error('Provide 1–32 distinct unsigned integer seeds');
if (values.profile !== 'nominal' && seeds.length < 2)
  throw new Error('Use at least two seeds');
await verifyFrozen();
const text = await readFile(values.machine!, 'utf8');
const machine = parseMachine(text);
const intervention: Intervention | undefined = values.remove
  ? { kind: 'remove', body: values.remove }
  : values.lock
    ? { kind: 'lock', body: values.lock }
    : undefined;
const started = performance.now();
const suites = [];
const configurations = [
  { label: 'nominal', conditions: { ...NOMINAL }, seed: seeds[0] },
];
if (values.profile !== 'nominal') {
  for (const seed of seeds)
    configurations.push({
      label: `perturbed-${seed}`,
      conditions: conditionsForSeed(seed),
      seed,
    });
  configurations.push({
    label: 'half-timestep',
    conditions: { ...NOMINAL, dtScale: 0.5 },
    seed: seeds[0],
  });
}
for (const config of configurations) {
  for (const mode of (values.profile === 'nominal'
    ? ['fresh']
    : ['fresh', 'persistent']) as ('fresh' | 'persistent')[]) {
    const suite = await evaluateSuite(machine, {
      conditions: config.conditions,
      mode,
      cases: caseOrder(config.seed),
      intervention,
    });
    suites.push({ label: config.label, seed: config.seed, ...suite });
    console.log(
      `${config.label} / ${mode}: ${suite.successes}/${suite.total}; reset failures: ${suite.resetFailures}`,
    );
  }
}
const artifact = {
  protocol: PROTOCOL_VERSION,
  profile: values.profile,
  machine: machine.name,
  complexity: {
    bodies: machine.bodies.length,
    colliders: machine.bodies.reduce((n, part) => n + part.shapes.length, 0),
    joints: machine.joints.length,
  },
  provenance: await provenance(text),
  seeds,
  intervention: intervention ?? null,
  wallSeconds: (performance.now() - started) / 1000,
  suites,
  accepted: suites.every(
    (s) => s.successes === s.total && s.resetFailures === 0,
  ),
  claim:
    'Rigid-body mechanism with ideal joints; not fabrication validation. Hidden seeds test physical robustness, not unseen arithmetic inputs.',
};
const out = values.out ?? `results/evaluation-${Date.now()}.json`;
await writeArtifact(out, artifact);
console.log(`Saved ${out}\nAccepted: ${artifact.accepted}`);
if (values['require-pass'] && !artifact.accepted) process.exitCode = 1;
