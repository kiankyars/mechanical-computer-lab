import { z } from 'zod';
import { FIXTURE_IDS, INPUTS, LIMITS } from './protocol';

const coordinate = z.number().min(-LIMITS.workspace).max(LIMITS.workspace);
const vector = z.tuple([coordinate, coordinate]);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const endpoint = z.string().max(48);
const positive = z.number().min(0.02).max(5);
const pose = {
  offset: vector.default([0, 0]),
  angle: z.number().min(-Math.PI).max(Math.PI).default(0),
};
const shape = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('box'),
    half: z.tuple([positive, positive]),
    ...pose,
  }),
  z.strictObject({ type: z.literal('ball'), radius: positive, ...pose }),
  z.strictObject({
    type: z.literal('convex'),
    vertices: z.array(vector).min(3).max(16),
    ...pose,
  }),
]);
const body = z.strictObject({
  id,
  label: z.string().max(100).optional(),
  type: z.enum(['fixed', 'dynamic']),
  position: vector,
  angle: z.number().min(-Math.PI).max(Math.PI).default(0),
  shapes: z.array(shape).min(1).max(8),
});
const jointBase = {
  id,
  a: endpoint,
  b: endpoint,
  anchorA: vector,
  anchorB: vector,
};
const limits = z.tuple([
  z.number().min(-20).max(20),
  z.number().min(-20).max(20),
]);
const joint = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('revolute'),
    ...jointBase,
    limits: z
      .tuple([
        z.number().min(-Math.PI).max(Math.PI),
        z.number().min(-Math.PI).max(Math.PI),
      ])
      .optional(),
  }),
  z.strictObject({
    type: z.literal('prismatic'),
    ...jointBase,
    axis: vector,
    limits,
  }),
  z.strictObject({ type: z.literal('fixed'), ...jointBase }),
  z.strictObject({
    type: z.literal('spring'),
    ...jointBase,
    restLength: z.number().min(0).max(20),
    stiffness: z.number().min(0.1).max(200),
    damping: z.number().min(0).max(20),
  }),
]);

export const machineSchema = z
  .strictObject({
    version: z.literal(1),
    name: z.string().min(1).max(100),
    description: z.string().max(2000).default(''),
    bodies: z.array(body).max(LIMITS.bodies),
    joints: z.array(joint).max(LIMITS.joints),
    carryCandidates: z.array(id).max(16).default([]),
  })
  .superRefine((machine, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    const ids = new Set<string>();
    let count = 0;
    for (const part of machine.bodies) {
      if (ids.has(part.id)) error(`Duplicate ID: ${part.id}`);
      ids.add(part.id);
      count += part.shapes.length;
      for (const s of part.shapes) {
        if (s.type !== 'convex') continue;
        let area = 0;
        for (let i = 0; i < s.vertices.length; i++) {
          const [a, b, c] = [
            s.vertices[i],
            s.vertices[(i + 1) % s.vertices.length],
            s.vertices[(i + 2) % s.vertices.length],
          ];
          const cross =
            (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
          if (cross <= 0.0001)
            error(
              `${part.id}: convex vertices must be strictly convex and counterclockwise`,
            );
          for (const p of s.vertices) {
            if (
              (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <
              -0.00001
            )
              error(`${part.id}: self-intersecting or nonconvex polygon`);
          }
          area += a[0] * b[1] - b[0] * a[1];
        }
        if (area < 0.002) error(`${part.id}: polygon too small`);
      }
    }
    if (count > LIMITS.colliders) error('Too many colliders');
    const allowed = new Set([...ids, ...FIXTURE_IDS]);
    const jointIds = new Set<string>();
    for (const j of machine.joints) {
      if (ids.has(j.id) || jointIds.has(j.id)) error(`Duplicate ID: ${j.id}`);
      jointIds.add(j.id);
      if (!allowed.has(j.a) || !allowed.has(j.b) || j.a === j.b)
        error(`${j.id}: invalid endpoints`);
      if (INPUTS.some((input) => input.id === j.a || input.id === j.b))
        error(`${j.id}: input fixtures permit contact coupling only`);
      if ('limits' in j && j.limits && j.limits[0] >= j.limits[1])
        error(`${j.id}: limits must increase`);
      if (
        j.type === 'prismatic' &&
        Math.abs(Math.hypot(...j.axis) - 1) > 0.00001
      )
        error(`${j.id}: axis must be a unit vector`);
    }
    for (const carry of machine.carryCandidates)
      if (!ids.has(carry)) error(`Unknown carry component: ${carry}`);
    if (
      new Set(machine.carryCandidates).size !== machine.carryCandidates.length
    )
      error('Duplicate carry component');
  });

export type Machine = z.infer<typeof machineSchema>;
export type Part = Machine['bodies'][number];
export type Shape = Part['shapes'][number];
export type Joint = Machine['joints'][number];

export function parseMachine(text: string): Machine {
  if (new TextEncoder().encode(text).length > LIMITS.fileBytes)
    throw new Error('Machine exceeds 256 KB');
  return machineSchema.parse(JSON.parse(text));
}
