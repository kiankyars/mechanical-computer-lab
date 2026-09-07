import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { machineSchema, parseMachine } from '../simulator/schema';

const starter = JSON.parse(
  readFileSync('machines/starter.machine.json', 'utf8'),
);
const part = {
  id: 'lever',
  type: 'dynamic',
  position: [0, 0],
  shapes: [{ type: 'box', half: [1, 0.1] }],
};

test('bundled machine files validate', () => {
  for (const name of ['starter', 'physics-fixture'])
    assert.equal(
      parseMachine(readFileSync(`machines/${name}.machine.json`, 'utf8'))
        .version,
      1,
    );
});

for (const [label, change] of Object.entries({
  'top-level code': { ...starter, onStep: 'return a+b' },
  'output mapping': { ...starter, outputs: { formula: 'a+b' } },
  'kinematic body': { ...starter, bodies: [{ ...part, type: 'kinematic' }] },
  'initial velocity': { ...starter, bodies: [{ ...part, velocity: [1, 0] }] },
  'nested callback': {
    ...starter,
    bodies: [
      { ...part, shapes: [{ type: 'box', half: [1, 1], callback: 'code' }] },
    ],
  },
  'reserved body': { ...starter, bodies: [{ ...part, id: '$s0' }] },
  'duplicate body': { ...starter, bodies: [part, part] },
  'missing endpoint': {
    ...starter,
    joints: [
      {
        id: 'link',
        type: 'revolute',
        a: 'missing',
        b: '$crank',
        anchorA: [0, 0],
        anchorB: [0, 0],
      },
    ],
  },
  'input joint': {
    ...starter,
    bodies: [part],
    joints: [
      {
        id: 'link',
        type: 'revolute',
        a: 'lever',
        b: '$a0',
        anchorA: [0, 0],
        anchorB: [0, 0],
      },
    ],
  },
  motor: {
    ...starter,
    bodies: [part],
    joints: [
      {
        id: 'link',
        type: 'revolute',
        a: 'lever',
        b: '$crank',
        anchorA: [0, 0],
        anchorB: [0, 0],
        motor: 10,
      },
    ],
  },
  'nonfinite geometry': {
    ...starter,
    bodies: [{ ...part, position: [Infinity, 0] }],
  },
  'zero-area geometry': {
    ...starter,
    bodies: [
      {
        ...part,
        shapes: [
          {
            type: 'convex',
            vertices: [
              [0, 0],
              [1, 0],
              [2, 0],
            ],
          },
        ],
      },
    ],
  },
  'invalid axis': {
    ...starter,
    bodies: [part],
    joints: [
      {
        id: 'link',
        type: 'prismatic',
        a: 'lever',
        b: '$ground',
        anchorA: [0, 0],
        anchorB: [0, 0],
        axis: [0, 0],
        limits: [-1, 1],
      },
    ],
  },
  'reversed limits': {
    ...starter,
    bodies: [part],
    joints: [
      {
        id: 'link',
        type: 'prismatic',
        a: 'lever',
        b: '$ground',
        anchorA: [0, 0],
        anchorB: [0, 0],
        axis: [1, 0],
        limits: [1, -1],
      },
    ],
  },
  'too many bodies': {
    ...starter,
    bodies: Array.from({ length: 129 }, (_, n) => ({
      ...part,
      id: `part-${n}`,
    })),
  },
}))
  test(`rejects ${label}`, () =>
    assert.throws(() => machineSchema.parse(change)));

test('oversized and malformed JSON fail closed', () => {
  assert.throws(() => parseMachine(' '.repeat(256001)));
  assert.throws(() => parseMachine('{broken'));
});
