# Mechanical Computer Lab

A fixed-physics benchmark for model-designed, mostly planar **two-bit mechanical adders**. A candidate is a JSON assembly of rigid parts and passive joints. Rapier simulates the mechanics; a separate evaluator checks the measured output flags. Three.js only displays physical state.

**Status:** runnable experiment infrastructure, not a solved adder. The included slider-crank fixture is a physics positive control. The empty adder starter intentionally produces zero and passes only **1/16** arithmetic cases. No model comparison has been run, and the task's difficulty has not been calibrated.

[Open the lab](https://kiankyars.github.io/mechanical-computer-lab/) · [GitHub repository](https://github.com/kiankyars/mechanical-computer-lab)

## Start

Node 22.13+ and npm are required. Dependencies and Rapier are pinned in `package-lock.json`.

```sh
npm ci
npm run check
npm run dev
```

Open [the local workbench](http://127.0.0.1:3018). Load a machine JSON, choose inputs, turn the crank, pause/step, slow playback, inspect parts, and evaluate all16 cases. Recorded playback moves only the visualization; it never writes back into physics. There is no account, cloud compute, telemetry, or paid model API in this experiment.

## GitHub Pages

Pushes to `main` validate the frozen protocol, build the same viewer as a static site, and deploy it through GitHub Actions. The simulation runs locally in your browser's worker; machine uploads are not sent to a server. Final experiment scoring still uses the separately trusted CLI evaluator.

To preview the published build locally:

```sh
npx --no-install vite build --config vite.pages.config.ts
npx --no-install vite preview --config vite.pages.config.ts
```

The static entry in `static/` reuses `app/page.tsx`. Its separate Vite configuration preserves the existing local server, pinned dependencies, and frozen experiment files.

## Evaluate a design

Edit a copy of `machines/starter.machine.json`, not the simulator or evaluator.

```sh
npm run evaluate -- --machine machines/starter.machine.json
npm run evaluate -- --machine machines/starter.machine.json --profile development --seeds 17,29
npm run trace -- --machine machines/starter.machine.json --a 3 --b 1
npm run evaluate -- --machine machines/physics-fixture.machine.json --remove connecting-rod
```

Reports and traces go into ignored `results/`, with unique filenames and no overwriting. Each CLI report includes the candidate, evaluator, and dependency-lock hashes, runtime/platform, trial conditions, failures, gauge measurements, work, and constraint diagnostics. Add `--require-pass` for a nonzero exit code on an unsuccessful machine. Ordinary evaluation exits successfully when it has produced a valid report, even if the candidate fails.

The development profile covers nominal conditions, two reproducible perturbation seeds, a half-timestep numerical audit, and **both fresh and persistent worlds**. Persistent cycles use reverse-crank reset and retain internal/output state. Input setting remains an external setup action, not a physically modeled actuator. `Reload` in the viewer is explicitly not a mechanical reset.

## Experiment boundary

| Candidate controls                                             | Experiment controls                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Part geometry, constant starting pose, fixed/dynamic body type | Rapier version, timestep, material settings and validity checks |
| Passive hinges, rails, fixed joints and bounded springs        | Four input sockets, three output gauges and decoding thresholds |
| Which proposed carry components to identify                    | One fixed, torque-limited crank schedule and final scoring      |

No executable candidate code, kinematic parts, participant motors, gear-ratio constraints, callbacks, custom output mappings, or task-conditioned internal initialization. Input fixtures allow **contact coupling only**, avoiding work injected through inconsistent input-joint anchors. Excess initial overlap, broken constraints, excessive spring preload, ambiguous flags and numerical failure all fail closed.

This is a **mechanism-level** benchmark: joints are ideal, and collisions between directly non-spring-jointed bodies are disabled. All other candidate interactions use contact geometry. A passing machine would not by itself demonstrate real tooth meshing, manufacturability, or a programmable computer.

## Repository

```text
simulator/       frozen schema, fixtures, drive, mechanics and gauge decoding
evaluator/       arithmetic oracle, fixed run schedule, scoring and perturbations
scripts/         evaluation, traces, provenance and freeze verification
machines/        editable candidate and clearly labelled physics fixture
viewer/         read-only Three.js renderer and physics-worker adapter
app/            local workbench interface
tests/          physics positive controls and adversarial evaluator tests
docs/           machine format and experiment protocol
protocol.lock.json  hashes of the frozen experiment implementation
```

- [Machine format and physical interface](docs/machine-format.md)
- [One-attempt versus feedback experiment](docs/experiment.md)
- [Validation and limitations](docs/validation.md)

`npm run verify:frozen` detects accidental drift. It is **not a security boundary against an agent that can edit the whole checkout**. Final evaluation must run the submitted JSON in a separately trusted copy whose evaluator hash was recorded before optimization. Never update the protocol lock to make a candidate pass.

## Sources

[Rapier rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/), [joints](https://rapier.rs/docs/user_guides/javascript/joints/), [determinism](https://rapier.rs/docs/user_guides/javascript/determinism/), and [Three.js](https://threejs.org/docs/). The engine performs general rigid-body dynamics; the addition oracle appears only in the evaluator.
