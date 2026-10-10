# Local validation

Initial validation: September 6, 2026, macOS arm64, Node 26.8.1. Workbench rebuild and reference adder: September 26, 2026, macOS arm64, Node 26.9.0. This is infrastructure validation, not a model-overhang result.

## Verified

- 41 automated tests: strict schema rejection, fixed gauge decoding, full-window scoring, capped/cleared drive torque, driven linkage motion, passive contact follower motion, removal breaking transmission, obstruction stalling the drive, deterministic fresh worlds, preservation of internal state across input changes, rejection of overlapping or preloaded assemblies, the reference adder (fresh and persistent 16/16, locked crank computes nothing, committed file identical to its generator's output), gallery honesty (any preset presented as an adder must score 16/16), the in-browser stress profile, share-link encoding and editor validation.
- Type checking and lint pass (`oxlint` with type-aware rules over all project sources). React Compiler-specific restrictions are disabled because the app does not use that compiler; hook correctness rules remain enabled.
- Production viewer build succeeds. The compiled physics-worker bundle is separately loaded in a Node worker, evaluates all 16 input pairs and runs the 8-suite development stress profile. This tests packaging and execution, not visual rendering.
- Manual browser QA (not scripted in this repository) of the workbench with headless Chromium and the Claude desktop browser pane at 1440×900, 1280×720, 768×1024 and 375×812: presets, input toggles, transport, playback scrubbing, evaluation, causal checks, the stress test, the editor, share links, keyboard shortcuts, WebGL-unavailable fallback, and no console errors or third-party requests.
- Local viewer endpoint returns HTTP 200.
- Dependency audit reports 0 vulnerabilities at validation time; this is a time-specific package advisory check, not a security guarantee.
- Freeze verification passes. `protocol.lock.json` covers all simulator, evaluator and CLI TypeScript files plus package manifests. The renderer is not trusted by the CLI evaluator. On September 26, 2026 the lock was regenerated for packaging changes only (`package.json`, `package-lock.json`, `scripts/check-built-worker.ts` after the move from Next/vinext to Vite); `simulator/`, `evaluator/` and Rapier 0.20.0 are byte-identical, so lock hashes recorded from commit 5218588 or earlier no longer match.

## Expected failing baseline

Command:

```sh
npm run evaluate -- --profile development --seeds 17,29
```

| Conditions          | Fresh-world success | Persistent-world success | Reset failures |
| ------------------- | ------------------- | ------------------------ | -------------- |
| Nominal             | 1/16                | 1/16                     | 0              |
| Perturbation seed 17 | 1/16                | 1/16                     | 0              |
| Perturbation seed 29 | 1/16                | 1/16                     | 0              |
| Half timestep       | 1/16                | 1/16                     | 0              |

The empty candidate outputs zero, so it is correct only for 0+0. Zero reset failures for an empty mechanism do not demonstrate a useful reset system. Aggregate acceptance is **false**. Seeds 17/29 here are physics conditions/order seeds, not independent model generations.

The physics fixture also does **not** add. Its recorded 3+1 trial shows real linkage motion but measured output 0 rather than 4, and is scored `wrong-answer`. Removal and obstruction checks concern the fixture's connecting rod/arm, not a claimed carry circuit.

## Reference adder (feasibility witness)

`machines/reference-adder.machine.json`: 18 bodies, 60 colliders, 32 joints (9 springs). Initial spring energy 3.27 J (limit 5 J), mostly a clutch preload held against a stop; the crank does about 8.2 J of work per operation.

```sh
npm run evaluate -- --machine machines/reference-adder.machine.json --profile development --seeds 17,29
```

| Conditions           | Fresh-world success | Persistent-world success | Reset failures |
| -------------------- | ------------------- | ------------------------ | -------------- |
| Nominal              | 16/16               | 16/16                    | 0              |
| Perturbation seed 17 | 16/16               | 16/16                    | 0              |
| Perturbation seed 29 | 16/16               | 16/16                    | 0              |
| Half timestep        | 16/16               | 16/16                    | 0              |

Aggregate acceptance is **true**. The development profile was also accepted with seeds 1234, 98765, 4242, 7, 31337, 5, 6, 77, 888, 9999 and 123456 (every suite 16/16, no reset failures). Correct zeros end at gauge displacement 0.10 and ones at 0.85. Designer-reported, not recorded in this repository: sweeps over all 16 corner combinations of the perturbation ranges (fresh, persistent and half-timestep persistent) plus 31 random fresh and 62 random persistent seeds all passed.

Causal checks (nominal, fresh worlds):

| Intervention         | Result | Reading                                                      |
| -------------------- | ------ | ------------------------------------------------------------ |
| Lock `crank-arm`     | 1/16   | every case reads 0: the crank does the computing work        |
| Remove `probe-pin`   | 1/16   | every case reads 0: outputs are never probed                 |
| Lock `sum-bar`       | 1/16   | every case reads 6: the code bar never leaves its start level |
| Remove `code-faces`  | 0/16   | cases read 3, 5, 6 or 7: without tooth faces, nubs enter gaps they should not |

Limits of this witness: the inclined slot that drives the code bar and the lost-motion links from the probe slider to the outputs are ideal prismatic joints, some spanning several units; the crank stop duplicates the harness bearing; timing margins at the slowest perturbation corner are modest (the designer measured outputs settling by about 4.95 s against the 5.5 s read window). It shows the task is solvable inside protocol v1, not that it is easy for models.

## Not yet demonstrated

- One-attempt versus feedback model runs, independent generation seeds, or capability conclusions.
- Success on privately chosen final perturbations or an independently operated evaluator checkout.
- A fully physical input actuator, accumulator, or programmable machine. (The reference adder's reverse-crank reset does pass every persistent suite; input entry remains an external setup action.)
- Tooth-level contact validity or fabrication/manufacturing robustness. Directly joined bodies use explicit ideal-joint collision exclusions.
- Optional WebMCP input contracts are unit-tested, but registration/invocation in a browser that supports WebMCP has not been verified.

Rapier WebAssembly and Three.js account for most of the client bundle (about 1 MB of app JavaScript plus a 2.2 MB physics worker). No paid model API is used by the repository.
