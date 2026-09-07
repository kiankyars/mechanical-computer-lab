import RAPIER from '@dimforge/rapier2d-compat';
import {
  CRANK,
  INPUTS,
  LIMITS,
  NOMINAL,
  OUTPUTS,
  SETTINGS,
  validateConditions,
  validateInputs,
  type Conditions,
} from './protocol';
import { machineSchema, type Joint, type Machine, type Shape } from './schema';
import { readGauges, type Readout } from './readout';

let initialization: Promise<void> | undefined;
export function initializePhysics(): Promise<void> {
  initialization ??= RAPIER.init();
  return initialization;
}

export type BodyView = {
  id: string;
  x: number;
  y: number;
  angle: number;
  type: string;
  shapes: Shape[];
};
export type Snapshot = {
  time: number;
  bodies: BodyView[];
  output: Readout;
  torque: number;
  positiveWork: number;
  crankAngle: number;
  maxJointError: number;
  maxPenetration: number;
};
export type Intervention = { kind: 'remove' | 'lock'; body: string };
const vector = (v: [number, number]) => ({ x: v[0], y: v[1] });
const key = (a: string, b: string) => [a, b].sort().join('|');
const clamp = (x: number, bound: number) =>
  Math.max(-bound, Math.min(bound, x));

function colliderDesc(shape: Shape): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc | null;
  if (shape.type === 'box') desc = RAPIER.ColliderDesc.cuboid(...shape.half);
  else if (shape.type === 'ball') desc = RAPIER.ColliderDesc.ball(shape.radius);
  else
    desc = RAPIER.ColliderDesc.convexHull(
      new Float32Array(shape.vertices.flat()),
    );
  if (!desc) throw new Error('Invalid convex geometry');
  return desc
    .setTranslation(...shape.offset)
    .setRotation(shape.angle)
    .setDensity(1)
    .setRestitution(0);
}

export class Simulation {
  #world: RAPIER.World;
  #bodies = new Map<string, RAPIER.RigidBody>();
  #shapes = new Map<string, Shape[]>();
  #colliders: { owner: string; collider: RAPIER.Collider }[] = [];
  #excludedContacts = new Set<string>();
  #machine: Machine;
  #conditions: Conditions;
  #time = 0;
  #steps = 0;
  #torque = 0;
  #work = 0;
  #maxJointError = 0;
  #maxPenetration = 0;
  #disposed = false;

  private constructor(
    machine: Machine,
    a: number,
    b: number,
    conditions: Conditions,
    intervention?: Intervention,
  ) {
    validateInputs(a, b);
    this.#machine = machineSchema.parse(machine);
    this.#conditions = validateConditions(conditions);
    this.#world = new RAPIER.World({ x: 0, y: 0 });
    this.#world.timestep = SETTINGS.dt * conditions.dtScale;
    this.#world.numSolverIterations = SETTINGS.solverIterations;
    this.#world.integrationParameters.maxCcdSubsteps = 4;
    try {
      this.#addBody('$ground', 'fixed', [0, 0], 0, []);
      for (const input of INPUTS) {
        const word = input.word === 0 ? a : b;
        const bit = (word >> input.bit) & 1;
        this.#addBody(
          input.id,
          'fixed',
          [
            input.x + bit * SETTINGS.inputTravel + conditions.inputOffset,
            input.y,
          ],
          0,
          [{ type: 'box', half: [0.18, 0.35], offset: [0, 0], angle: 0 }],
        );
      }
      this.#addBody(CRANK.id, 'dynamic', [CRANK.x, CRANK.y], 0, [
        { type: 'ball', radius: CRANK.radius, offset: [0, 0], angle: 0 },
      ]);
      this.#world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: CRANK.x, y: CRANK.y }, { x: 0, y: 0 }),
        this.#body('$ground'),
        this.#body(CRANK.id),
        true,
      );
      for (const output of OUTPUTS) {
        this.#addBody(output.id, 'dynamic', [output.x, output.y], 0, [
          { type: 'box', half: [0.28, 0.28], offset: [0, 0], angle: 0 },
        ]);
        const guide = this.#world.createImpulseJoint(
          RAPIER.JointData.prismatic(
            { x: output.x, y: output.y },
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ),
          this.#body('$ground'),
          this.#body(output.id),
          true,
        ) as RAPIER.PrismaticImpulseJoint;
        guide.setLimits(0, SETTINGS.outputTravel);
      }
      for (const part of this.#machine.bodies)
        this.#addBody(
          part.id,
          part.type,
          part.position,
          part.angle,
          part.shapes,
        );
      let springEnergy = 0;
      for (const spec of this.#machine.joints) {
        const aBody = this.#body(spec.a),
          bBody = this.#body(spec.b);
        const aAnchor = vector(spec.anchorA),
          bAnchor = vector(spec.anchorB);
        let data: RAPIER.JointData;
        if (spec.type === 'revolute')
          data = RAPIER.JointData.revolute(aAnchor, bAnchor);
        else if (spec.type === 'prismatic')
          data = RAPIER.JointData.prismatic(
            aAnchor,
            bAnchor,
            vector(spec.axis),
          );
        else if (spec.type === 'spring') {
          data = RAPIER.JointData.spring(
            spec.restLength,
            spec.stiffness,
            spec.damping,
            aAnchor,
            bAnchor,
          );
          const aa = this.#anchor(spec.a, spec.anchorA),
            bb = this.#anchor(spec.b, spec.anchorB);
          springEnergy +=
            0.5 *
            spec.stiffness *
            (Math.hypot(aa.x - bb.x, aa.y - bb.y) - spec.restLength) ** 2;
        } else data = RAPIER.JointData.fixed(aAnchor, 0, bAnchor, 0);
        const created = this.#world.createImpulseJoint(
          data,
          aBody,
          bBody,
          true,
        );
        if (spec.type !== 'spring') {
          created.setContactsEnabled(false);
          this.#excludedContacts.add(key(spec.a, spec.b));
          if ('limits' in spec && spec.limits)
            (created as RAPIER.UnitImpulseJoint).setLimits(...spec.limits);
        }
      }
      if (springEnergy > LIMITS.springEnergy)
        throw new Error(
          `Initial spring energy ${springEnergy.toFixed(3)} exceeds limit`,
        );
      this.#validateState(true);
      if (intervention) this.#intervene(intervention);
    } catch (error) {
      this.#world.free();
      throw error;
    }
  }

  static async create(
    machine: Machine,
    a = 0,
    b = 0,
    conditions: Conditions = { ...NOMINAL },
    intervention?: Intervention,
  ): Promise<Simulation> {
    await initializePhysics();
    return new Simulation(machine, a, b, conditions, intervention);
  }

  get dt(): number {
    return SETTINGS.dt * this.#conditions.dtScale;
  }
  get time(): number {
    return this.#time;
  }

  #body(id: string): RAPIER.RigidBody {
    const body = this.#bodies.get(id);
    if (!body) throw new Error(`Missing body ${id}`);
    return body;
  }

  #addBody(
    id: string,
    type: 'fixed' | 'dynamic',
    position: [number, number],
    angle: number,
    shapes: Shape[],
  ) {
    const desc =
      type === 'fixed'
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic();
    desc
      .setTranslation(...position)
      .setRotation(angle)
      .setLinearDamping(SETTINGS.damping)
      .setAngularDamping(SETTINGS.damping)
      .setCcdEnabled(true)
      .setCanSleep(false);
    const body = this.#world.createRigidBody(desc);
    this.#bodies.set(id, body);
    this.#shapes.set(id, shapes);
    for (const shape of shapes) {
      const collider = this.#world.createCollider(
        colliderDesc(shape).setFriction(
          SETTINGS.friction * this.#conditions.frictionScale,
        ),
        body,
      );
      this.#colliders.push({ owner: id, collider });
    }
    if (type === 'dynamic' && !(body.mass() > 0))
      throw new Error(`${id}: dynamic mass must be positive`);
  }

  #anchor(id: string, point: [number, number]) {
    const body = this.#body(id),
      p = body.translation(),
      angle = body.rotation();
    return {
      x: p.x + Math.cos(angle) * point[0] - Math.sin(angle) * point[1],
      y: p.y + Math.sin(angle) * point[0] + Math.cos(angle) * point[1],
    };
  }

  #jointError(joint: Joint): number {
    if (
      joint.type === 'spring' ||
      !this.#bodies.has(joint.a) ||
      !this.#bodies.has(joint.b)
    )
      return 0;
    const a = this.#anchor(joint.a, joint.anchorA),
      b = this.#anchor(joint.b, joint.anchorB);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const relative =
      this.#body(joint.b).rotation() - this.#body(joint.a).rotation();
    const angleError = Math.atan2(Math.sin(relative), Math.cos(relative));
    if (joint.type === 'prismatic') {
      const angle = this.#body(joint.a).rotation();
      const ax =
        Math.cos(angle) * joint.axis[0] - Math.sin(angle) * joint.axis[1];
      const ay =
        Math.sin(angle) * joint.axis[0] + Math.cos(angle) * joint.axis[1];
      const q = dx * ax + dy * ay;
      return Math.max(
        Math.abs(dx * ay - dy * ax),
        joint.limits[0] - q,
        q - joint.limits[1],
        Math.abs(angleError),
      );
    }
    const angularError =
      joint.type === 'fixed'
        ? Math.abs(angleError)
        : joint.limits
          ? Math.max(
              0,
              joint.limits[0] - angleError,
              angleError - joint.limits[1],
            )
          : 0;
    return Math.max(Math.hypot(dx, dy), angularError);
  }

  #validateState(initial: boolean, inputSetup = false) {
    for (const [id, body] of this.#bodies) {
      const p = body.translation(),
        v = body.linvel();
      const values = [p.x, p.y, v.x, v.y, body.rotation(), body.angvel()];
      if (!values.every(Number.isFinite))
        throw new Error(`${id}: nonfinite state`);
      if (Math.abs(p.x) > LIMITS.workspace || Math.abs(p.y) > LIMITS.workspace)
        throw new Error(`${id}: left workspace`);
      if (
        Math.hypot(v.x, v.y) > LIMITS.speed ||
        Math.abs(body.angvel()) > LIMITS.angularSpeed
      )
        throw new Error(`${id}: excessive velocity`);
      for (const shape of this.#shapes.get(id) ?? []) {
        const offset = this.#anchor(id, shape.offset),
          angle = body.rotation() + shape.angle;
        if (shape.type === 'ball') {
          if (
            Math.abs(offset.x) + shape.radius > LIMITS.workspace ||
            Math.abs(offset.y) + shape.radius > LIMITS.workspace
          )
            throw new Error(`${id}: geometry left workspace`);
        } else {
          const vertices =
            shape.type === 'convex'
              ? shape.vertices
              : [
                  [-shape.half[0], -shape.half[1]],
                  [shape.half[0], -shape.half[1]],
                  [shape.half[0], shape.half[1]],
                  [-shape.half[0], shape.half[1]],
                ];
          for (const [x, y] of vertices)
            if (
              Math.abs(offset.x + Math.cos(angle) * x - Math.sin(angle) * y) >
                LIMITS.workspace ||
              Math.abs(offset.y + Math.sin(angle) * x + Math.cos(angle) * y) >
                LIMITS.workspace
            )
              throw new Error(`${id}: geometry left workspace`);
        }
      }
    }
    for (const joint of this.#machine.joints) {
      if (!this.#bodies.has(joint.a) || !this.#bodies.has(joint.b)) continue;
      const residual = this.#jointError(joint);
      this.#maxJointError = Math.max(this.#maxJointError, residual);
      if (
        residual >
        (initial ? LIMITS.initialJointError : LIMITS.runningJointError)
      )
        throw new Error(
          `${joint.id}: inconsistent joint anchors (${residual.toFixed(3)})`,
        );
    }
    for (const output of OUTPUTS) {
      const body = this.#body(output.id);
      if (
        Math.abs(body.translation().y - output.y) > 0.05 ||
        Math.abs(body.rotation()) > 0.05 ||
        body.translation().x < output.x - 0.05 ||
        body.translation().x > output.x + SETTINGS.outputTravel + 0.05
      )
        throw new Error(`${output.id}: output rail violated`);
    }
    const crankPosition = this.#body(CRANK.id).translation();
    if (
      Math.hypot(crankPosition.x - CRANK.x, crankPosition.y - CRANK.y) >
      LIMITS.runningJointError
    )
      throw new Error('Crank pivot violated');
    const checkPair = (
      a: { owner: string; collider: RAPIER.Collider },
      b: { owner: string; collider: RAPIER.Collider },
    ) => {
      if (
        a.owner === b.owner ||
        this.#excludedContacts.has(key(a.owner, b.owner))
      )
        return;
      if (this.#body(a.owner).isFixed() && this.#body(b.owner).isFixed())
        return;
      const contact = a.collider.contactCollider(b.collider, 0);
      const penetration = contact ? Math.max(0, -contact.distance) : 0;
      const newlyConfiguredContact =
        inputSetup &&
        INPUTS.some((input) => input.id === a.owner || input.id === b.owner);
      this.#maxPenetration = Math.max(this.#maxPenetration, penetration);
      if (
        penetration >
        (initial || newlyConfiguredContact
          ? LIMITS.initialPenetration
          : LIMITS.runningPenetration)
      )
        throw new Error(
          `Excessive penetration: ${a.owner}/${b.owner} (${penetration.toFixed(3)})`,
        );
    };
    if (initial || inputSetup) {
      for (let i = 0; i < this.#colliders.length; i++)
        for (let j = i + 1; j < this.#colliders.length; j++)
          checkPair(this.#colliders[i], this.#colliders[j]);
    } else {
      const byHandle = new Map(
        this.#colliders.map((c) => [c.collider.handle, c]),
      );
      for (const a of this.#colliders)
        this.#world.contactPairsWith(a.collider, (b) => {
          const other = byHandle.get(b.handle);
          if (other && b.handle > a.collider.handle) checkPair(a, other);
        });
    }
  }

  #intervene(intervention: Intervention) {
    if (!this.#machine.bodies.some((body) => body.id === intervention.body))
      throw new Error('Interventions require a participant body');
    const body = this.#body(intervention.body);
    if (intervention.kind === 'lock')
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    else {
      this.#colliders = this.#colliders.filter(
        (c) => c.owner !== intervention.body,
      );
      this.#world.removeRigidBody(body);
      this.#bodies.delete(intervention.body);
      this.#shapes.delete(intervention.body);
    }
  }

  step(direction: -1 | 0 | 1 = 1): void {
    if (this.#disposed) throw new Error('Simulation disposed');
    if (![-1, 0, 1].includes(direction))
      throw new Error('Invalid drive direction');
    const crank = this.#body(CRANK.id);
    crank.resetTorques(true);
    const target =
      direction * SETTINGS.crankSpeed * this.#conditions.speedScale;
    this.#torque =
      direction === 0
        ? 0
        : clamp(
            SETTINGS.crankGain * (target - crank.angvel()),
            SETTINGS.crankTorque * this.#conditions.torqueScale,
          );
    if (this.#torque !== 0) crank.addTorque(this.#torque, true);
    const before = crank.angvel();
    this.#world.step();
    this.#work += Math.max(
      0,
      this.#torque * (before + crank.angvel()) * 0.5 * this.dt,
    );
    this.#steps++;
    this.#time = this.#steps * this.dt;
    // Every integration step is checked; no invalid interval can disappear between trace samples.
    this.#validateState(false);
  }

  configureInputs(a: number, b: number): void {
    validateInputs(a, b);
    for (const input of INPUTS) {
      const bit = ((input.word === 0 ? a : b) >> input.bit) & 1;
      this.#body(input.id).setTranslation(
        {
          x:
            input.x + bit * SETTINGS.inputTravel + this.#conditions.inputOffset,
          y: input.y,
        },
        true,
      );
    }
    this.#world.propagateModifiedBodyPositionsToColliders();
    this.#validateState(false, true);
  }

  readOutput(): Readout {
    return readGauges(
      OUTPUTS.map((output) => {
        const body = this.#body(output.id),
          v = body.linvel();
        return {
          x: body.translation().x,
          speed: Math.max(Math.hypot(v.x, v.y), Math.abs(body.angvel())),
        };
      }),
    );
  }

  snapshot(): Snapshot {
    return {
      time: this.#time,
      output: this.readOutput(),
      torque: this.#torque,
      positiveWork: this.#work,
      crankAngle: this.#body(CRANK.id).rotation(),
      maxJointError: this.#maxJointError,
      maxPenetration: this.#maxPenetration,
      bodies: [...this.#bodies]
        .filter(([id]) => id !== '$ground')
        .map(([id, body]) => {
          const p = body.translation();
          return {
            id,
            x: p.x,
            y: p.y,
            angle: body.rotation(),
            type: body.isFixed() ? 'fixed' : 'dynamic',
            shapes: structuredClone(this.#shapes.get(id)!),
          };
        }),
    };
  }

  dispose(): void {
    if (!this.#disposed) {
      this.#world.free();
      this.#disposed = true;
    }
  }
}
