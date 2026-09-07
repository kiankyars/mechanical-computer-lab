# Local validation

Initial validation: September 6, 2026, macOS arm64, Node 26.8.1. This is infrastructure validation, not a model-overhang result.

## Verified

- 32 automated tests: strict schema rejection, fixed gauge decoding, full-window scoring, capped/cleared drive torque, driven linkage motion, passive contact follower motion, removal breaking transmission, obstruction stalling the drive, deterministic fresh worlds, preservation of internal state across input changes, and rejection of overlapping or preloaded assemblies.

- Type checking and project-source lint pass. Generated component-library sources are excluded from project lint; React Compiler-specific restrictions are disabled because the app does not use that compiler. Hook correctness rules remain enabled.
- Production viewer build succeeds. The compiled physics-worker bundle is separately loaded in a Node worker and evaluates all 16 input pairs. This tests packaging and execution, not visual rendering in a browser.
- Local viewer endpoint returns HTTP 200.
- Dependency audit reports 0 vulnerabilities at validation time; this is a time-specific package advisory check, not a security guarantee.
- Freeze verification passes. `protocol.lock.json` covers all simulator, evaluator and CLI TypeScript files plus package manifests. The renderer is not trusted by the CLI evaluator.

## Expected failing baseline

Command:

```sh
npm run evaluate -- --profile development --seeds 17,29
```

| Conditions          | Fresh-world success | Persistent-world success | Reset failures |
| ------------------- | ------------------- | ------------------------ | -------------- |
| Nominal             | 1/16                | 1/16                     | 0              |
| Perturbation seed17 | 1/16                | 1/16                     | 0              |
| Perturbation seed29 | 1/16                | 1/16                     | 0              |
| Half timestep       | 1/16                | 1/16                     | 0              |

The empty candidate outputs zero, so it is correct only for 0+0. Zero reset failures for an empty mechanism do not demonstrate a useful reset system. Aggregate acceptance is **false**. Seeds 17/29 here are physics conditions/order seeds, not independent model generations.

The physics fixture also does **not** add. Its recorded 3+1 trial shows real linkage motion but measured output 0 rather than 4, and is scored `wrong-answer`. Removal and obstruction checks concern the fixture's connecting rod/arm, not a claimed carry circuit.

## Not yet demonstrated

- A functioning two-bit adder in this component/interface design space.
- One-attempt versus feedback model runs, independent generation seeds, or capability conclusions.
- Success on privately chosen final perturbations or an independently operated evaluator checkout.
- A mechanically reusable adder reset, a fully physical input actuator, accumulator, or programmable machine.
- Tooth-level contact validity or fabrication/manufacturing robustness. Directly joined bodies use explicit ideal-joint collision exclusions.
- Full browser interaction/visual QA. No such QA was requested; WebGL/rendering and responsive interaction remain an explicit validation gap. Optional WebMCP input contracts are unit-tested, but registration/invocation in a supporting browser has not been verified.

The unclassified-route and large-client-chunk notices from the current viewer build are nonfatal. Rapier WebAssembly and Three.js account for a substantial portion of the client bundle. No public deployment or paid model execution was performed.
