import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
import type { Suite } from '../evaluator/evaluate';
import { LIMITS, PROTOCOL_VERSION } from '../simulator/protocol';
import type { Intervention } from '../simulator/world';
import type { MachineScene } from '../viewer/scene';
import { registerLabTools } from '../viewer/webmcp';
import { About } from './components/About';
import { Computation } from './components/Computation';
import { Editor } from './components/Editor';
import {
  Evaluation,
  emptyEvaluation,
  type EvaluationState,
  type InterventionKind,
} from './components/Evaluation';
import { Header, type PickerEntry } from './components/Header';
import { Inspector } from './components/Inspector';
import { Shortcuts } from './components/Shortcuts';
import { Stage } from './components/Stage';
import {
  STRESS_SEEDS,
  Stress,
  emptyStress,
  type StressState,
} from './components/Stress';
import { Transport } from './components/Transport';
import { Cancelled, runBatch } from './lib/batch';
import {
  copyText,
  downloadJson,
  downloadText,
  sha256,
  slug,
} from './lib/download';
import { bytes, phaseInfo, trialKind } from './lib/format';
import {
  DEFAULT_INPUTS,
  DEFAULT_PRESET,
  PRESETS,
  type Preset,
} from './lib/machines';
import { decodeMachine, machinePayload, shareUrl } from './lib/share';
import { SPEEDS, useSimulation } from './lib/useSimulation';
import { describeInvalid, validateMachineText } from './lib/validate';

type Source = 'preset' | 'uploaded' | 'shared' | 'edited';
type Custom = Exclude<Source, 'preset'>;
type Entry = PickerEntry & {
  source: Source;
  autoplay?: boolean;
  /** Shown beside the measured sum, e.g. "not an adder". */
  note?: string;
};
type Alert = {
  kind: 'load' | 'setup' | 'runtime' | 'share' | 'file';
  title: string;
  message: string;
};
type Tab = 'evaluate' | 'stress' | 'parts';

const presetEntry = (preset: Preset): Entry => ({
  key: `preset:${preset.id}`,
  source: 'preset',
  title: preset.title,
  blurb: preset.blurb,
  tag: 'preset',
  text: preset.text,
  autoplay: preset.autoplay,
  note: preset.note,
});
const DEFAULT_ENTRY = presetEntry(DEFAULT_PRESET);
const PRESET_ENTRIES = PRESETS.map(presetEntry);

const BLURB: Record<Custom, (detail: string) => string> = {
  uploaded: (file) => `Opened from ${file}`,
  shared: () => 'Shared machine · loaded from a link',
  edited: () => 'Your edits, kept in this browser tab',
};
const customEntry = (
  source: Custom,
  text: string,
  name: string,
  detail = '',
): Entry => ({
  key: source,
  source,
  title: name,
  blurb: BLURB[source](detail),
  tag: source,
  text,
});

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** An error message as a sentence (terminal punctuation added if missing). */
const errorText = (error: unknown) => {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
};

function clearShareHash() {
  if (machinePayload(location.hash) !== null)
    history.replaceState(null, '', location.pathname + location.search);
}

export function App() {
  const [custom, setCustom] = useState<Partial<Record<Custom, Entry>>>({});
  const [current, setCurrent] = useState<Entry | null>(null);
  const [inputs, setInputsState] = useState<[number, number]>(DEFAULT_INPUTS);
  const [kind, setKind] = useState<InterventionKind>('none');
  const [body, setBody] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [toast, setToast] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState('');
  const [tilt, setTilt] = useState(false);
  const [tab, setTab] = useState<Tab>('evaluate');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [keysOpen, setKeysOpen] = useState(false);
  const [evaluation, setEvaluation] =
    useState<EvaluationState>(emptyEvaluation);
  const [stress, setStress] = useState<StressState>(emptyStress);
  const [batchKind, setBatchKind] = useState<'evaluate' | 'stress' | null>(
    null,
  );

  const intervention = useMemo<Intervention | undefined>(
    () => (kind !== 'none' && body ? { kind, body } : undefined),
    [kind, body],
  );

  const sceneRef = useRef<MachineScene | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lower = useRef<HTMLElement>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const interventionRef = useRef(intervention);
  interventionRef.current = intervention;
  const lastGood = useRef<Entry | null>(null);
  /** Machine texts whose world has been built at least once. A failure for
   * one of these is a setup failure (inputs / intervention); for any other
   * text it means the machine itself could not be built. */
  const builtTexts = useRef(new Set<string>());
  /** The last custom machine of each kind that actually built, restored to
   * the gallery when a newer one of the same kind fails. */
  const goodCustom = useRef<Partial<Record<Custom, Entry>>>({});
  const failedDraft = useRef<string | null>(null);
  const autoplay = useRef(false);
  const batch = useRef<{ cancel: () => void } | null>(null);
  const runId = useRef(0);
  const toastTimer = useRef(0);
  /** Success message shown once the chosen machine's world is actually built. */
  const readyToast = useRef<string | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3600);
  }, []);

  // ---------------------------------------------------------------------
  // Machine selection and loading

  const onLoadError = useCallback((message: string) => {
    const entry = currentRef.current;
    const [a, b] = inputsRef.current;
    readyToast.current = null;
    autoplay.current = false;
    if (!entry) return;
    if (!builtTexts.current.has(entry.text)) {
      // This machine has never been built: fall back to the last machine that
      // was, whatever its kind (a second broken upload must not replace the
      // first good one).
      const good = lastGood.current;
      const fallback =
        good && good.text !== entry.text
          ? good
          : DEFAULT_ENTRY.text !== entry.text
            ? DEFAULT_ENTRY
            : null;
      setAlert({
        kind: 'load',
        title: `Couldn’t build “${entry.title}”`,
        message: `The world failed to build with A = ${a}, B = ${b}: ${errorText(message)} ${
          fallback ? `Kept ${fallback.title} instead.` : 'Nothing else to show.'
        }`,
      });
      if (entry.source === 'shared') clearShareHash();
      if (entry.source === 'edited') failedDraft.current = entry.text;
      if (entry.source !== 'preset') {
        const source = entry.source;
        const previous = goodCustom.current[source];
        setCustom((all) => {
          const next = { ...all };
          if (previous && previous.text !== entry.text) next[source] = previous;
          else delete next[source];
          return next;
        });
      }
      if (fallback) setCurrent(fallback);
      return;
    }
    // The machine builds, but not with these inputs / this intervention.
    const iv = interventionRef.current;
    const extra = iv
      ? ` with ${iv.body} ${iv.kind === 'remove' ? 'removed' : 'locked'}`
      : '';
    setAlert({
      kind: 'setup',
      title: `Setup failed for A = ${a}, B = ${b}${extra}`,
      message: `${errorText(message)} ${
        iv
          ? 'Restore the intact machine or choose other inputs.'
          : 'This machine builds with other inputs; choose different ones.'
      }`,
    });
  }, []);

  const onRuntimeError = useCallback((message: string) => {
    setAlert({
      kind: 'runtime',
      title: 'Physics error — the world stopped',
      message: `${errorText(message)} Recorded frames stay scrubbable; Reload (L) builds a fresh world.`,
    });
  }, []);

  const onReady = useCallback(() => {
    const entry = currentRef.current;
    if (entry) {
      lastGood.current = entry;
      builtTexts.current.add(entry.text);
      if (entry.source !== 'preset') goodCustom.current[entry.source] = entry;
    }
    if (entry?.source === 'edited') failedDraft.current = null;
    if (readyToast.current) showToast(readyToast.current);
    readyToast.current = null;
    setAlert((a) =>
      a && (a.kind === 'setup' || a.kind === 'runtime') ? null : a,
    );
  }, [showToast]);

  const sim = useSimulation({
    text: current?.text ?? null,
    inputs,
    intervention,
    reloadKey,
    onLoadError,
    onRuntimeError,
    onReady,
  });

  const choose = useCallback((entry: Entry) => {
    autoplay.current = false;
    if (entry.source === 'preset') readyToast.current = null;
    setCurrent(entry);
    setSelected('');
    setPreview('');
    setKind('none');
    setBody('');
    setViewIndex(null);
    if (entry.source !== 'shared') clearShareHash();
    setAlert((a) =>
      a && (a.kind === 'setup' || a.kind === 'runtime') ? null : a,
    );
  }, []);

  const adopt = useCallback(
    (entry: Entry) => {
      // Same text and no intervention to clear: the world is not rebuilt, so
      // there will be no fresh "ready" to announce the success.
      if (
        entry.text === currentRef.current?.text &&
        !interventionRef.current &&
        readyToast.current
      ) {
        showToast(readyToast.current);
        readyToast.current = null;
      }
      setCustom((all) => ({ ...all, [entry.source]: entry }));
      choose(entry);
    },
    [choose, showToast],
  );

  // Boot: a machine in the URL fragment wins over the default preset.
  useEffect(() => {
    const boot = async (initial: boolean) => {
      const payload = machinePayload(location.hash);
      if (payload === null) {
        if (initial) {
          setCurrent(DEFAULT_ENTRY);
          autoplay.current =
            !!DEFAULT_ENTRY.autoplay && !prefersReducedMotion();
        }
        return;
      }
      try {
        const text = await decodeMachine(payload);
        const result = validateMachineText(text);
        if (!result.ok) throw new Error(describeInvalid(result));
        readyToast.current = `Shared machine loaded: ${result.machine.name}`;
        adopt(customEntry('shared', text, result.machine.name));
      } catch (error) {
        setAlert({
          kind: 'share',
          title: 'This share link couldn’t be opened',
          message: `${errorText(error)}${initial ? ' Showing the default machine instead.' : ' Kept the current machine.'}`,
        });
        clearShareHash();
        if (initial) setCurrent(DEFAULT_ENTRY);
      }
    };
    void boot(true);
    const onHash = () => void boot(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [adopt]);

  // Autoplay: turn the crank once after the very first load.
  const { status: simStatus, phase: simPhase, play } = sim;
  useEffect(() => {
    if (autoplay.current && simStatus === 'ready' && simPhase === 'ready') {
      autoplay.current = false;
      play();
    }
  }, [simStatus, simPhase, play]);

  const openFile = useCallback(
    async (file: File) => {
      const title = `Couldn’t open ${file.name}`;
      if (file.size > LIMITS.fileBytes) {
        setAlert({
          kind: 'file',
          title,
          message: `The file is ${bytes(file.size)}; the limit is 256 KB. Kept the current machine.`,
        });
        return;
      }
      const text = await file.text();
      const result = validateMachineText(text);
      if (!result.ok) {
        setAlert({
          kind: 'file',
          title,
          message: `${describeInvalid(result)} Kept the current machine.`,
        });
        return;
      }
      readyToast.current = `Loaded ${result.machine.name}`;
      adopt(customEntry('uploaded', text, result.machine.name, file.name));
    },
    [adopt],
  );

  const setInputs = useCallback((next: [number, number]) => {
    setInputsState((prev) =>
      prev[0] === next[0] && prev[1] === next[1] ? prev : next,
    );
    setViewIndex(null);
  }, []);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    setViewIndex(null);
  }, []);

  /** Rebuild a fresh world and turn the crank once it is ready. */
  const runAgain = useCallback(() => {
    autoplay.current = true;
    reload();
  }, [reload]);

  /** The selected machine, parsed from its text. Unlike sim.machine (the
   * last world that was built) it always matches the header, so the parts
   * list and the causal-check menu never describe a different machine. */
  const currentText = current?.text;
  const currentMachine = useMemo(() => {
    if (currentText === undefined) return null;
    const result = validateMachineText(currentText);
    return result.ok ? result.machine : null;
  }, [currentText]);

  // ---------------------------------------------------------------------
  // Frames, replay and the renderer

  const frames = sim.frames.current;
  const replaying = viewIndex !== null && viewIndex < frames.length - 1;
  const index = replaying ? viewIndex : frames.length - 1;
  const displayed = frames[index] ?? sim.live;
  const previousFrame = index > 0 ? (frames[index - 1] ?? null) : null;
  const ops = sim.ops.current;
  const displayedOp = displayed ? ops[displayed.op] : undefined;
  const reverse = displayedOp?.kind === 'reverse';
  const phase = phaseInfo(
    sim.status,
    displayed?.phase ?? 'ready',
    displayed?.t ?? 0,
    reverse,
  );
  const traceFrames = displayed
    ? frames.filter((f) => f.op === displayed.op)
    : [];

  useEffect(() => {
    sceneRef.current?.setMachine(sim.machine);
  }, [sim.machine]);
  useEffect(() => {
    if (displayed) sceneRef.current?.update(displayed.snapshot);
  }, [displayed]);
  useEffect(() => {
    sceneRef.current?.setTilt(tilt);
  }, [tilt]);

  const highlightId = useMemo(() => {
    const id = preview || selected;
    const joint = currentMachine?.joints.find((j) => j.id === id);
    if (!joint) return id;
    return joint.b.startsWith('$') ? joint.a : joint.b;
  }, [preview, selected, currentMachine]);
  useEffect(() => {
    sceneRef.current?.highlight(highlightId);
  }, [highlightId]);

  useEffect(() => {
    const machine = currentMachine;
    setSelected((id) =>
      !id ||
      id.startsWith('$') ||
      machine?.bodies.some((b) => b.id === id) ||
      machine?.joints.some((j) => j.id === id)
        ? id
        : '',
    );
  }, [currentMachine]);

  const goLive = useCallback(() => setViewIndex(null), []);
  const scrub = useCallback(
    (i: number) => {
      sim.pause();
      setViewIndex(i);
    },
    [sim],
  );

  const finished = sim.status === 'ready' && sim.phase === 'finished';
  const toggle = useCallback(() => {
    goLive();
    if (finished) runAgain();
    else sim.toggle();
  }, [goLive, sim, finished, runAgain]);
  const step = useCallback(() => {
    goLive();
    sim.step();
  }, [goLive, sim]);
  const reverseReset = useCallback(() => {
    goLive();
    sim.reverseReset();
  }, [goLive, sim]);

  // Screen-reader narration of phase changes.
  const lastPhase = useRef('');
  useEffect(() => {
    if (replaying || phase.key === lastPhase.current) return;
    lastPhase.current = phase.key;
    const value = displayed?.snapshot.output.value;
    setAnnouncement(
      phase.key === 'finished'
        ? `${phase.label}. Gauges read ${value ?? 'ambiguous'}.`
        : `${phase.label}, ${phase.detail}.`,
    );
  }, [phase.key, phase.label, phase.detail, replaying, displayed]);

  // ---------------------------------------------------------------------
  // Evaluation and stress test (separate workers, cancellable)

  const resetBatches = useCallback(() => {
    runId.current++;
    batch.current?.cancel();
    batch.current = null;
    setBatchKind(null);
    setEvaluation(emptyEvaluation());
    setStress(emptyStress());
  }, []);
  // Results belong to one machine + intervention; inputs do not matter.
  useEffect(() => resetBatches(), [currentText, intervention, resetBatches]);

  /** The intact machine's score, kept so that a causal check can be compared
   * with it after the intervention's own evaluation. */
  const [intact, setIntact] = useState<{
    text: string;
    successes: number;
    total: number;
  } | null>(null);
  const intactRef = useRef(intact);
  intactRef.current = intact;
  const [measuringIntact, setMeasuringIntact] = useState(false);

  /** After a causal-check evaluation, score the intact machine too (once per
   * machine text) so the two can be compared without toggling back. */
  const measureIntact = useCallback((text: string) => {
    const job = runBatch({
      text,
      request: { type: 'evaluate' },
      final: 'evaluated',
    });
    batch.current = job;
    setBatchKind('evaluate');
    setMeasuringIntact(true);
    job.promise
      .then(
        ({ suite }) =>
          setIntact({ text, successes: suite.successes, total: suite.total }),
        () => {},
      )
      .finally(() => {
        setMeasuringIntact(false);
        if (batch.current === job) {
          batch.current = null;
          setBatchKind(null);
        }
      });
  }, []);

  const evaluate = useCallback((): Promise<Suite> => {
    const entry = currentRef.current;
    if (!entry) return Promise.reject(new Error('No machine is loaded yet'));
    if (batch.current)
      return Promise.reject(new Error('Another evaluation is already running'));
    const id = ++runId.current;
    const iv = interventionRef.current;
    setTab('evaluate');
    setEvaluation({ ...emptyEvaluation(), status: 'running' });
    setBatchKind('evaluate');
    setAnnouncement('Evaluating all 16 input pairs.');
    const job = runBatch({
      text: entry.text,
      intervention: iv,
      request: { type: 'evaluate' },
      final: 'evaluated',
      onMessage: (message) => {
        if (id !== runId.current || message.type !== 'progress') return;
        const { trial } = message;
        setEvaluation((s) => {
          const cells = s.cells.slice();
          cells[trial.a * 4 + trial.b] = trial;
          return { ...s, cells, count: s.count + 1 };
        });
      },
    });
    batch.current = job;
    let scored = false;
    return job.promise
      .then(
        ({ suite }) => {
          scored = true;
          if (!iv)
            setIntact({
              text: entry.text,
              successes: suite.successes,
              total: suite.total,
            });
          if (id === runId.current) {
            const cells = emptyEvaluation().cells;
            for (const trial of suite.trials)
              cells[trial.a * 4 + trial.b] = trial;
            setEvaluation({
              status: 'done',
              cells,
              count: suite.trials.length,
              suite,
              message: '',
            });
            setAnnouncement(
              `Evaluation finished: ${suite.successes} of ${suite.total} correct and stable.`,
            );
          }
          return suite;
        },
        (error: unknown) => {
          if (id === runId.current)
            setEvaluation((s) => ({
              ...s,
              status: error instanceof Cancelled ? 'cancelled' : 'error',
              message: errorText(error),
            }));
          throw error;
        },
      )
      .finally(() => {
        if (batch.current === job) {
          batch.current = null;
          setBatchKind(null);
          if (
            iv &&
            scored &&
            id === runId.current &&
            intactRef.current?.text !== entry.text
          )
            measureIntact(entry.text);
        }
      });
  }, [measureIntact]);

  const runStress = useCallback(() => {
    const entry = currentRef.current;
    if (!entry || batch.current) return;
    const id = ++runId.current;
    setTab('stress');
    setStress({ ...emptyStress(), status: 'running' });
    setBatchKind('stress');
    setAnnouncement('Stress test started.');
    const job = runBatch({
      text: entry.text,
      intervention: interventionRef.current,
      request: { type: 'stress', seeds: STRESS_SEEDS },
      final: 'stressed',
      onMessage: (message) => {
        if (id !== runId.current) return;
        if (message.type === 'stress-suite-start')
          setStress((s) => {
            const cells = s.cells.slice();
            cells[message.suiteIndex] = {
              label: message.label,
              seed: message.seed,
              mode: message.mode,
              conditions: message.conditions,
              trials: [],
              total: 16,
              successes: null,
              resetFailures: null,
            };
            return {
              ...s,
              cells,
              current: { suiteIndex: message.suiteIndex, index: -1 },
            };
          });
        else if (message.type === 'stress-progress')
          setStress((s) => {
            const cells = s.cells.slice();
            const cell = cells[message.suiteIndex];
            if (cell)
              cells[message.suiteIndex] = {
                ...cell,
                trials: [...cell.trials, message.trial],
              };
            return {
              ...s,
              cells,
              done: s.done + 1,
              current: { suiteIndex: message.suiteIndex, index: message.index },
            };
          });
        else if (message.type === 'stress-suite')
          setStress((s) => {
            const cells = s.cells.slice();
            cells[message.suiteIndex] = message.suite;
            return { ...s, cells };
          });
      },
    });
    batch.current = job;
    job.promise
      .then(
        ({ summary }) => {
          if (id !== runId.current) return;
          setStress((s) => ({
            ...s,
            status: 'done',
            summary,
            cells: summary.suites,
            current: null,
          }));
          setAnnouncement(
            `Stress test finished. Accepted: ${summary.accepted ? 'yes' : 'no'}.`,
          );
        },
        (error: unknown) => {
          if (id !== runId.current) return;
          setStress((s) => ({
            ...s,
            status: error instanceof Cancelled ? 'cancelled' : 'error',
            message: errorText(error),
            current: null,
          }));
        },
      )
      .finally(() => {
        if (batch.current === job) {
          batch.current = null;
          setBatchKind(null);
        }
      });
  }, []);

  const cancelBatch = useCallback(() => batch.current?.cancel(), []);

  // ---------------------------------------------------------------------
  // Files and links

  const name = currentMachine?.name ?? current?.title ?? 'machine';
  const interventionText = intervention
    ? `${intervention.body} ${intervention.kind === 'remove' ? 'removed' : 'locked'}`
    : '';

  /** Identifies exactly which machine text a downloaded report scored. The
   * hash matches the CLI report's `machineSha256` for the same file. */
  const provenance = useCallback(async () => {
    const entry = currentRef.current;
    return {
      app: { name: 'mechanical-computer-lab', version: __APP_VERSION__ },
      machine: name,
      machineSource: entry?.source ?? null,
      machineSha256: entry ? await sha256(entry.text) : null,
      machineDefinition: currentMachine,
      generatedAt: new Date().toISOString(),
    };
  }, [name, currentMachine]);

  const saveTrace = useCallback(() => {
    const list = sim.frames.current;
    if (list.length < 2) return;
    downloadJson(`${slug(name)}-trace-a${inputs[0]}-b${inputs[1]}.json`, {
      protocol: PROTOCOL_VERSION,
      kind: 'browser-trace',
      note: 'Frames recorded from the in-browser world. Playback never writes back into physics; this is not an evaluation.',
      machine: sim.machine,
      inputs: { a: inputs[0], b: inputs[1] },
      intervention: intervention ?? null,
      operations: sim.ops.current,
      frames: list.map((f) => ({
        operation: f.op,
        phase: f.phase,
        operationTime: f.t,
        snapshot: f.snapshot,
      })),
    });
  }, [sim, name, inputs, intervention]);

  const saveReport = useCallback(async () => {
    const suite = evaluation.suite;
    if (!suite) return;
    downloadJson(`${slug(name)}-evaluation.json`, {
      protocol: PROTOCOL_VERSION,
      profile: 'browser-nominal',
      note: 'In-browser evaluation: nominal conditions, a fresh world per case. Final scoring uses the trusted CLI evaluator.',
      ...(await provenance()),
      intervention: intervention ?? null,
      ...suite,
    });
  }, [evaluation.suite, name, intervention, provenance]);

  const saveStress = useCallback(async () => {
    const summary = stress.summary;
    if (!summary) return;
    downloadJson(`${slug(name)}-stress.json`, {
      protocol: PROTOCOL_VERSION,
      note: 'In-browser development profile (public seeds). Final scoring uses the trusted CLI evaluator with private seeds.',
      ...(await provenance()),
      ...summary,
    });
  }, [stress.summary, name, provenance]);

  const copyLink = useCallback(
    async (text: string, updateAddress: boolean) => {
      try {
        const url = await shareUrl(text, location.href);
        if (updateAddress) history.replaceState(null, '', url);
        const copied = await copyText(url);
        showToast(
          copied
            ? 'Share link copied. The machine travels inside the URL; nothing is uploaded.'
            : updateAddress
              ? 'Share link is in the address bar (clipboard unavailable).'
              : 'Clipboard unavailable — use Share link in the header instead.',
        );
      } catch (error) {
        setAlert({
          kind: 'share',
          title: 'Couldn’t make a share link',
          message: errorText(error),
        });
      }
    },
    [showToast],
  );

  const openEditor = useCallback(() => {
    if (!currentRef.current) return;
    setEditorText(failedDraft.current ?? currentRef.current.text);
    setEditorOpen(true);
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard shortcuts

  const fit = useCallback(() => sceneRef.current?.fit(), []);

  const stageRef = useRef<HTMLDivElement>(null);
  /** Load a truth-table case into the live world and run it where it can be
   * seen: scroll the stage into view, rebuild, turn the crank. */
  const watchCase = useCallback(
    (next: [number, number]) => {
      const [a, b] = inputsRef.current;
      autoplay.current = true;
      if (a === next[0] && b === next[1]) reload();
      else setInputs(next);
      stageRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [reload, setInputs],
  );
  const clearIntervention = useCallback(() => {
    setKind('none');
    setBody('');
  }, []);
  const keys = useRef({
    toggle,
    step,
    reverseReset,
    reload,
    evaluate: () => {},
    speed: sim.setSpeed,
    fit,
    escape: () => {},
  });
  keys.current = {
    toggle,
    step,
    reverseReset,
    reload,
    evaluate: () => {
      if (sim.status === 'ready' || sim.status === 'failed') {
        lower.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'nearest',
        });
        evaluate().catch(() => {});
      }
    },
    speed: sim.setSpeed,
    fit,
    escape: () => {
      if (replaying) goLive();
      else if (selected) setSelected('');
    },
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      // Only text entry swallows shortcuts; sliders and buttons do not.
      if (
        target?.closest(
          'textarea, select, [contenteditable="true"], input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])',
        )
      )
        return;
      if (document.querySelector('dialog[open]')) return;
      const k = keys.current;
      const onControl = target?.closest(
        'button, a[href], summary, [role="button"], [role="slider"], [role="tab"]',
      );
      const key = event.key;
      if (key === ' ') {
        if (onControl) return; // Space activates the focused control.
        k.toggle();
      } else if (key === 'ArrowRight' || key === '.') k.step();
      else if (key === 'r' || key === 'R') k.reverseReset();
      else if (key === 'l' || key === 'L') k.reload();
      else if (key === 'e' || key === 'E') k.evaluate();
      else if (key === 'f' || key === 'F') k.fit();
      else if (key === '?') setKeysOpen(true);
      else if (key === 'Escape') k.escape();
      else if (/^[1-5]$/.test(key)) k.speed(SPEEDS[Number(key) - 1].value);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------------
  // WebMCP (optional browser agent tools)

  const read = useRef(() => ({}) as unknown);
  read.current = () => {
    const snap = displayed?.snapshot;
    return {
      machine: sim.machine?.name ?? null,
      source: current?.source ?? null,
      inputs: { a: inputs[0], b: inputs[1] },
      intervention: intervention ?? null,
      status: sim.status,
      phase: phase.label,
      running: sim.running,
      replaying,
      time: snap?.time ?? null,
      operationTime: displayed?.t ?? null,
      output: snap
        ? {
            binary: snap.output.binary,
            value: snap.output.value,
            settled: snap.output.settled,
            gauges: snap.output.gauges.map(
              ({ id, displacement, speed, bit }) => ({
                id,
                displacement,
                speed,
                bit,
              }),
            ),
          }
        : null,
      note: 'Instantaneous gauge reading, not a verdict; evaluation checks the full read window.',
      evaluation: evaluation.suite
        ? {
            successes: evaluation.suite.successes,
            total: evaluation.suite.total,
          }
        : null,
      stress: stress.summary
        ? {
            accepted: stress.summary.accepted,
            suites: stress.summary.suites.map((s) => ({
              label: s.label,
              mode: s.mode,
              successes: s.successes,
              total: s.total,
              resetFailures: s.resetFailures,
            })),
          }
        : null,
    };
  };
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;
  useEffect(
    () =>
      registerLabTools(
        () => read.current(),
        async () => {
          const suite = await evaluateRef.current();
          return {
            successes: suite.successes,
            total: suite.total,
            trials: suite.trials.map(
              ({ a, b, expected, observed, passed, reason }) => ({
                a,
                b,
                expected,
                observed,
                passed,
                reason,
              }),
            ),
          };
        },
      ),
    [],
  );

  // ---------------------------------------------------------------------
  // Render

  const entries: Entry[] = [
    ...PRESET_ENTRIES,
    ...(['uploaded', 'shared', 'edited'] as const).flatMap((source) =>
      custom[source] ? [custom[source]] : [],
    ),
  ];
  const tabs: {
    id: Tab;
    label: string;
    badge: string;
    modified?: boolean;
  }[] = [
    {
      id: 'evaluate',
      label: 'Truth table',
      badge: evaluation.suite
        ? `${evaluation.suite.successes}/16`
        : evaluation.status === 'running'
          ? '…'
          : '',
      modified: !!intervention,
    },
    {
      id: 'stress',
      label: 'Stress test',
      badge: stress.summary
        ? stress.summary.accepted
          ? '✓'
          : '✗'
        : stress.status === 'running'
          ? '…'
          : '',
      modified: !!intervention,
    },
    {
      id: 'parts',
      label: 'Parts',
      badge: currentMachine
        ? String(currentMachine.bodies.length + currentMachine.joints.length)
        : '',
    },
  ];
  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const order = tabs.map((t) => t.id);
    const i = order.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? order[(i + 1) % order.length]
        : event.key === 'ArrowLeft'
          ? order[(i + order.length - 1) % order.length]
          : event.key === 'Home'
            ? order[0]
            : event.key === 'End'
              ? order[order.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  const canEvaluate =
    !!current && (sim.status === 'ready' || sim.status === 'failed');
  /** The evaluator's verdict for the live inputs (same machine and
   * intervention: results are cleared whenever either changes). */
  const scored = evaluation.cells[inputs[0] * 4 + inputs[1]];
  const verdict = scored
    ? { kind: trialKind(scored), expected: scored.expected }
    : null;

  return (
    <div className="app">
      <a className="skip" href="#bench">
        Skip to the workbench
      </a>
      <Header
        entries={entries}
        currentKey={current?.key ?? null}
        onPick={(key) => {
          const entry = entries.find((e) => e.key === key);
          if (entry) choose(entry);
        }}
        onOpenFile={() => fileInput.current?.click()}
        onEdit={openEditor}
        onShare={() => current && void copyLink(current.text, true)}
        onSaveTrace={saveTrace}
        canSaveTrace={frames.length > 1}
        onKeys={() => setKeysOpen(true)}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file);
        }}
      />

      {alert && (
        <div className="alert" role="alert" data-kind={alert.kind}>
          <span className="alert-glyph" aria-hidden="true">
            !
          </span>
          <div className="alert-text">
            <strong>{alert.title}</strong>
            <span>{alert.message}</span>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Dismiss"
            onClick={() => setAlert(null)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <main className="bench" id="bench">
        <div className="bench-main" ref={stageRef}>
          <Stage
            sceneRef={sceneRef}
            machine={currentMachine}
            frame={displayed}
            previous={previousFrame}
            world={
              displayed ? 'ok' : sim.status === 'failed' ? 'failed' : 'loading'
            }
            intervention={intervention ?? null}
            onClearIntervention={clearIntervention}
            phase={phase}
            running={sim.running}
            replay={
              replaying && frames.length
                ? {
                    index,
                    total: frames.length,
                    liveTime: frames[frames.length - 1].snapshot.time,
                  }
                : null
            }
            tilt={tilt}
            onTilt={setTilt}
            onFit={fit}
            selected={selected}
            onSelect={setSelected}
            onInspect={() => {
              setTab('parts');
              lower.current?.scrollIntoView({
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                block: 'start',
              });
            }}
            onDropFile={(file) => void openFile(file)}
          />
          <Transport
            status={sim.status}
            running={sim.running}
            canRun={sim.canRun}
            phase={sim.phase}
            speed={sim.speed}
            onSpeed={sim.setSpeed}
            onToggle={toggle}
            finished={finished}
            onStep={step}
            onReverse={reverseReset}
            onReload={reload}
            frames={frames}
            ops={ops}
            index={Math.max(0, index)}
            replaying={replaying}
            onScrub={scrub}
            onLive={goLive}
          />
        </div>
        <Computation
          inputs={inputs}
          onInputs={setInputs}
          disabled={!current}
          interventionText={interventionText}
          note={current?.source === 'preset' ? current.note : undefined}
          finished={displayed?.phase === 'finished' && !reverse}
          verdict={verdict}
          frame={displayed}
          traceFrames={traceFrames}
          replaying={replaying}
          reverse={reverse}
        />
      </main>

      <section
        className="lower"
        ref={lower}
        aria-label="Testing and inspection"
      >
        <div
          className="tabs"
          role="tablist"
          aria-label="Testing and inspection"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              // Only the selected tab's panel exists in the document.
              aria-controls={tab === t.id ? `panel-${t.id}` : undefined}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              {t.label}
              {t.badge && <span className="tab-badge">{t.badge}</span>}
              {t.modified && (
                <span
                  className="tab-mod"
                  title={`Causal check active: ${interventionText}`}
                >
                  <span aria-hidden="true">⊘</span>
                  <span className="sr-only">
                    (causal check: {interventionText})
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          className="tabpanel"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === 'evaluate' && (
            <Evaluation
              state={evaluation}
              busy={batchKind !== null}
              canEvaluate={canEvaluate}
              onEvaluate={() => void evaluate().catch(() => {})}
              onCancel={cancelBatch}
              onSaveReport={() => void saveReport()}
              inputs={inputs}
              onWatch={watchCase}
              machine={currentMachine}
              interventionText={interventionText}
              measuringIntact={measuringIntact}
              intact={
                intact && intact.text === current?.text
                  ? { successes: intact.successes, total: intact.total }
                  : null
              }
              interventionKind={kind}
              interventionBody={body}
              onInterventionKind={(next) => {
                setKind(next);
                if (next === 'none') setBody('');
              }}
              onInterventionBody={setBody}
            />
          )}
          {tab === 'stress' && (
            <Stress
              state={stress}
              busy={batchKind !== null}
              canRun={canEvaluate}
              onRun={runStress}
              onCancel={cancelBatch}
              onSave={() => void saveStress()}
              interventionText={interventionText}
            />
          )}
          {tab === 'parts' && (
            <Inspector
              machine={currentMachine}
              snapshot={displayed?.snapshot ?? null}
              selected={selected}
              onSelect={setSelected}
              onPreview={setPreview}
            />
          )}
        </div>
      </section>

      <About />

      <Editor
        open={editorOpen}
        initialText={editorText}
        title={current?.title ?? 'machine'}
        onClose={() => setEditorOpen(false)}
        onApply={(text) => {
          const result = validateMachineText(text);
          if (!result.ok) return;
          setEditorOpen(false);
          readyToast.current = `Applied ${result.machine.name}`;
          adopt(customEntry('edited', text, result.machine.name));
        }}
        onDownload={(text) => {
          let fileName = name;
          try {
            fileName = (JSON.parse(text) as { name?: string }).name ?? name;
          } catch {
            // keep the current name
          }
          downloadText(
            `${slug(fileName)}.machine.json`,
            text,
            'application/json',
          );
        }}
        onCopyLink={(text) => void copyLink(text, false)}
      />
      <Shortcuts open={keysOpen} onClose={() => setKeysOpen(false)} />

      <div
        className="toast"
        aria-live="polite"
        data-show={toast ? true : undefined}
      >
        {toast}
      </div>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
