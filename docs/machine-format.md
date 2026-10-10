# Machine format v1

The authoritative parser is `simulator/schema.ts`. `npm run schema --silent` prints its structural JSON Schema; semantic and physical checks additionally run in the parser/simulator. Unknown keys are rejected recursively.

```json
{
  "version": 1,
  "name": "My candidate",
  "description": "A passive mechanical assembly",
  "bodies": [
    {
      "id": "lever",
      "type": "dynamic",
      "position": [0, 0],
      "angle": 0,
      "shapes": [{ "type": "box", "half": [1, 0.1] }]
    }
  ],
  "joints": [
    {
      "id": "hinge",
      "type": "revolute",
      "a": "$ground",
      "b": "lever",
      "anchorA": [0, 0],
      "anchorB": [0, 0],
      "limits": [-1, 1]
    }
  ],
  "carryCandidates": []
}
```

Units are meters, kilograms, seconds and radians in an intentionally abstract tabletop-scale model. Gravity is zero (horizontal plane). Display thickness has no physics meaning; parts cannot cross through a different visual depth. Collider-derived density is 1, restitution 0, nominal friction 0.4, linear/angular damping 0.2.

## Fixed interface

Coordinates below are the neutral position. Inputs shift by one unit in **+x** for bit 1 and are held fixed during operation. A0/B0 are the low bits. Only these fixture positions depend on the selected inputs.

| Body ID   | Position   | Behavior                                             |
| --------- | ---------- | ---------------------------------------------------- |
| `$a0`     | (-9, 4.5)  | A bit 0, fixed box with half extents (0.18, 0.35)    |
| `$a1`     | (-9, 1.5)  | A bit 1, same geometry                               |
| `$b0`     | (-9, -1.5) | B bit 0, same geometry                               |
| `$b1`     | (-9, -4.5) | B bit 1, same geometry                               |
| `$s0`     | (8, 3)     | Output bit 0, dynamic box half extents (0.28, 0.28)  |
| `$s1`     | (8, 0)     | Output bit 1, same geometry                          |
| `$s2`     | (8, -3)    | Output bit 2, same geometry                          |
| `$crank`  | (0, -6)    | Dynamic radius 0.5 disk with a fixed revolute bearing |
| `$ground` | (0, 0)     | Fixed, colliderless joint anchor frame               |

Output flags have ideal horizontal prismatic rails with travel `[0,1]`. Their absolute x positions determine bits: displacement `[-0.05,0.25]` is 0 and `[0.75,1.05]` is 1; everything else is invalid. The tolerated extra travel allows small numerical error, not a larger signaling range. Each gauge's linear and angular speed must be at most 0.08 over **every integration step in the final 0.5 seconds**. All samples must agree. The decimal display decodes `S₂ S₁ S₀`; it never adds the inputs.

Candidate parts may contact inputs but may not joint to them. Joints may attach to the crank, ground, outputs, and other candidate parts. Inputs, outputs and the crank cannot be replaced, removed, redefined or resized by the candidate.

## Parts

IDs match `[a-z][a-z0-9_-]{0,47}`. Body types are `fixed` or `dynamic`. Every body has a constant initial `position`, optional `angle` (default 0), and 1–8 shapes. Geometry must stay inside `[-12,12]²`; all bodies begin with zero velocity.

- Box: `{"type":"box","half":[halfWidth,halfHeight]}`.
- Disk: `{"type":"ball","radius":0.3}`.
- Convex polygon: `{"type":"convex","vertices":[[-1,-0.2],[1,-0.2],[0,0.5]]}`. Supply 3–16 strictly convex, counterclockwise vertices, not a self-intersecting polygon.

Each shape accepts optional body-local `offset:[x,y]` and `angle`; defaults are zero. Boxes/disks have dimensions/radii between 0.02 and 5. Geometry is collision geometry, not a decorative mesh. Compound shapes on one body may overlap and their masses add. Density, collision masks, sensors, velocities and per-body forces are not candidate options.

Limits: 256 KB JSON, 128 bodies, 384 total candidate colliders, 256 joints. See `simulator/protocol.ts` for the exact frozen numbers.

## Connections

Every joint has `id`, `a`, `b`, `anchorA`, `anchorB`. Anchors are body-local, including the ground's world-aligned local frame.

| Type        | Additional fields                                                                 |
| ----------- | --------------------------------------------------------------------------------- |
| `revolute`  | Optional increasing `limits:[minAngle,maxAngle]`, both within [-π,π]              |
| `prismatic` | Unit `axis:[x,y]` in body A's frame and increasing `limits:[minTravel,maxTravel]` |
| `fixed`     | None; starting rotations must agree                                               |
| `spring`    | `restLength`0–20, `stiffness`0.1–200, `damping`0–20                               |

Non-spring anchors/limits must initially be consistent to 0.00001. Fixed/prismatic rotations must agree modulo a full turn; ongoing combined anchor/angular residuals may not exceed 0.2. Output guide y/rotation/travel tolerances are stricter (0.05). Tight construction checks prevent deliberate joint preload; finite numerical tolerance still allows tiny solver corrections, so this is not a claim of mathematically zero initialization work. Persistent input setup uses running tolerances for existing joints, not the stricter construction tolerance.

Initial total spring energy is limited to 5 J. Springs are passive ideal force elements, not individually force-capped actuators. Inputs and fixed supports are external constraints, so the reported crank work is **not** a complete thermodynamic energy audit.

Contacts between bodies directly connected by a non-spring joint are disabled, allowing ideal bearing/linkage geometry. This is an explicit abstraction and must not be presented as contact-level validation of those interfaces. Other dynamic overlaps exceeding 0.00001 at construction or 0.15 during motion fail the trial. Reconfigured input contacts must satisfy the construction overlap tolerance. Static-static overlaps are allowed for supports. All integration steps check finite state, geometry bounds, velocities, candidate joint residuals and harness bearing/gauge constraints.

## Drive and reset

The fixed operation is 4 seconds forward drive, 2 seconds free settling. Rapier uses a 1/240-second timestep and 12 solver iterations. At each drive step, torque is `clamp(4 × (targetSpeed − measuredCrankSpeed), ±3)` with nominal target 2 rad/s. Settling clears torque; it never snaps the crank or its velocity to zero. Limits of 100 units/s and 100 rad/s catch unstable simulations.

The reset schedule is the same but with target speed −2 rad/s. Internal bodies/output flags are retained. Reset is successful only if all output flags settle to zero. It does **not** promise that every internal part or the crank phase has returned to its initial state; subsequent operation tests detect resulting history dependence. Between operations only the four designated inputs are repositioned, and new overlap/constraint checks run. This is externally configured input entry, not a fully physical input/reset mechanism.
