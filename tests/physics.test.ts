import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../simulator/world';
import { parseMachine, machineSchema } from '../simulator/schema';
import { SETTINGS } from '../simulator/protocol';

const starter = parseMachine(
  readFileSync('machines/starter.machine.json', 'utf8'),
);
const fixture = parseMachine(
  readFileSync('machines/physics-fixture.machine.json', 'utf8'),
);

test('crank torque is capped and removed during settling', async () => {
  const simulation = await Simulation.create(starter);
  try {
    for (let n = 0; n < 100; n++) {
      simulation.step(1);
      assert(Math.abs(simulation.snapshot().torque) <= SETTINGS.crankTorque);
    }
    const velocityAngle = simulation.snapshot().crankAngle;
    simulation.step(0);
    assert.equal(simulation.snapshot().torque, 0);
    assert.notEqual(simulation.snapshot().crankAngle, velocityAngle);
  } finally {
    simulation.dispose();
  }
});

test('slider-crank transmits motion, passive contact moves follower, removal breaks transmission', async () => {
  const whole = await Simulation.create(fixture);
  const removed = await Simulation.create(fixture, 0, 0, undefined, {
    kind: 'remove',
    body: 'connecting-rod',
  });
  let sliderTravel = 0,
    followerTravel = 0;
  try {
    for (let n = 0; n < 720; n++) {
      whole.step(1);
      removed.step(1);
      if (n % 8 === 0) {
        const state = whole.snapshot();
        sliderTravel = Math.max(
          sliderTravel,
          5 - state.bodies.find((b) => b.id === 'slider')!.x,
        );
        followerTravel = Math.max(
          followerTravel,
          state.bodies.find((b) => b.id === 'follower')!.y + 4.8,
        );
      }
    }
    assert(sliderTravel > 1, `slider travel ${sliderTravel}`);
    assert(followerTravel > 0.03, `contact follower travel ${followerTravel}`);
    assert(
      Math.abs(
        removed.snapshot().bodies.find((b) => b.id === 'slider')!.x - 5,
      ) < 0.001,
    );
  } finally {
    whole.dispose();
    removed.dispose();
  }
});

test('fresh worlds repeat and changing inputs does not reset internal parts', async () => {
  const first = await Simulation.create(fixture),
    second = await Simulation.create(fixture);
  try {
    for (let n = 0; n < 100; n++) {
      first.step(1);
      second.step(1);
    }
    assert.deepEqual(first.snapshot(), second.snapshot());
    const before = first
      .snapshot()
      .bodies.filter((b) => !['$a0', '$a1', '$b0', '$b1'].includes(b.id));
    first.configureInputs(3, 1);
    assert.deepEqual(
      first
        .snapshot()
        .bodies.filter((b) => !['$a0', '$a1', '$b0', '$b1'].includes(b.id)),
      before,
    );
    const snapshot = first.snapshot();
    snapshot.bodies[0].x = 900;
    assert.notEqual(first.snapshot().bodies[0].x, 900);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('input collisions, broken joint anchors and excess spring preload fail setup', async () => {
  const part = {
    id: 'part',
    type: 'dynamic',
    position: [-9, 4.5],
    shapes: [{ type: 'ball', radius: 0.2 }],
  };
  await assert.rejects(
    () =>
      Simulation.create(machineSchema.parse({ ...starter, bodies: [part] })),
    /penetration/,
  );
  const body = { ...part, position: [0, 0] };
  const link = {
    id: 'link',
    a: '$ground',
    b: 'part',
    anchorA: [1, 0],
    anchorB: [0, 0],
  };
  await assert.rejects(
    () =>
      Simulation.create(
        machineSchema.parse({
          ...starter,
          bodies: [body],
          joints: [{ ...link, type: 'revolute' }],
        }),
      ),
    /joint anchors/,
  );
  await assert.rejects(
    () =>
      Simulation.create(
        machineSchema.parse({
          ...starter,
          bodies: [body],
          joints: [
            {
              ...link,
              type: 'spring',
              restLength: 3,
              stiffness: 200,
              damping: 1,
            },
          ],
        }),
      ),
    /spring energy/,
  );
});

test('revolute limits cannot inject initialization work', async () => {
  const machine = machineSchema.parse({
    ...starter,
    bodies: [
      {
        id: 'rotor',
        type: 'dynamic',
        position: [0, 0],
        shapes: [{ type: 'box', half: [1, 0.1] }],
      },
    ],
    joints: [
      {
        id: 'bearing',
        type: 'revolute',
        a: '$ground',
        b: 'rotor',
        anchorA: [0, 0],
        anchorB: [0, 0],
        limits: [1, 2],
      },
    ],
  });
  await assert.rejects(() => Simulation.create(machine), /joint anchors/);
});

test('persistent input setup tolerates intentionally removed fixed and prismatic endpoints', async () => {
  for (const type of ['fixed', 'prismatic']) {
    const machine = machineSchema.parse({
      ...starter,
      bodies: [
        {
          id: 'part',
          type: 'dynamic',
          position: [0, 0],
          shapes: [{ type: 'ball', radius: 0.2 }],
        },
      ],
      joints: [
        {
          id: 'link',
          type,
          a: '$ground',
          b: 'part',
          anchorA: [0, 0],
          anchorB: [0, 0],
          ...(type === 'prismatic' ? { axis: [1, 0], limits: [-1, 1] } : {}),
        },
      ],
    });
    const simulation = await Simulation.create(machine, 0, 0, undefined, {
      kind: 'remove',
      body: 'part',
    });
    try {
      assert.doesNotThrow(() => simulation.configureInputs(1, 0));
      simulation.step(0);
    } finally {
      simulation.dispose();
    }
  }
});

test('sub-tolerance preload from the earlier protocol is rejected', async () => {
  const machine = machineSchema.parse({
    ...starter,
    bodies: [
      {
        id: 'rotor',
        type: 'dynamic',
        position: [0, 0],
        shapes: [{ type: 'box', half: [1, 0.1] }],
      },
    ],
    joints: [
      {
        id: 'bearing',
        type: 'revolute',
        a: '$ground',
        b: 'rotor',
        anchorA: [0, 0],
        anchorB: [0, 0],
        limits: [0.024, 1],
      },
    ],
  });
  await assert.rejects(() => Simulation.create(machine), /joint anchors/);
});

test('equivalent wrapped fixed-joint orientations are accepted', async () => {
  const machine = machineSchema.parse({
    ...starter,
    bodies: [
      {
        id: 'base',
        type: 'fixed',
        position: [0, 0],
        angle: Math.PI,
        shapes: [{ type: 'ball', radius: 0.2 }],
      },
      {
        id: 'lever',
        type: 'dynamic',
        position: [0, 0],
        angle: -Math.PI,
        shapes: [{ type: 'box', half: [1, 0.1] }],
      },
    ],
    joints: [
      {
        id: 'weld',
        type: 'fixed',
        a: 'base',
        b: 'lever',
        anchorA: [0, 0],
        anchorB: [0, 0],
      },
    ],
  });
  const simulation = await Simulation.create(machine);
  simulation.dispose();
});

test('obstruction stalls the finite-torque crank instead of prescribing motion', async () => {
  const simulation = await Simulation.create(fixture, 0, 0, undefined, {
    kind: 'lock',
    body: 'crank-arm',
  });
  try {
    for (let n = 0; n < 240; n++) simulation.step(1);
    const state = simulation.snapshot();
    assert(Math.abs(state.crankAngle) < 0.001);
    assert(Math.abs(state.torque) <= SETTINGS.crankTorque);
    assert(
      Math.abs(state.bodies.find((body) => body.id === 'slider')!.x - 5) <
        0.001,
    );
  } finally {
    simulation.dispose();
  }
});
