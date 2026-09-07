'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import starter from '../machines/starter.machine.json';
import fixture from '../machines/physics-fixture.machine.json';
import type { Snapshot } from '../simulator/world';
import type { Machine } from '../simulator/schema';
import type { Suite, Trial } from '../evaluator/evaluate';
import { LIMITS } from '../simulator/protocol';
import { MachineScene } from '../viewer/scene';
import { registerLabTools } from '../viewer/webmcp';
// Vite generates this constructor; it is not an export in the worker source.
// oxlint-disable-next-line import/default
import PhysicsWorker from '../viewer/simulation.worker?worker';

function Choice({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && onChange(next)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-full h-9">
        <SelectValue>
          {choices.find((x) => x.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [machineText, setMachineText] = useState(JSON.stringify(fixture));
  const [machine, setMachine] = useState<Machine | null>(null);
  const [preset, setPreset] = useState('fixture');
  const [inputs, setInputs] = useState<[number, number]>([3, 1]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [status, setStatus] = useState('Loading physics');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [intervention, setIntervention] = useState('none');
  const [interventionBody, setInterventionBody] = useState('');
  const [reload, setReload] = useState(0);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [progress, setProgress] = useState<Trial[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<MachineScene | null>(null);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(false);
  const frames = useRef<Snapshot[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const evaluation = useRef<{
    resolve: (suite: Suite) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const state = useRef({ machine: '', inputs, status, snapshot, suite });
  state.current = {
    machine: machine?.name ?? '',
    inputs,
    status,
    snapshot,
    suite,
  };

  useEffect(() => {
    if (!stage.current) return;
    try {
      scene.current = new MachineScene(stage.current, setSelected);
    } catch {
      setError('WebGL is unavailable. The command-line evaluator still works.');
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [machineText, intervention, interventionBody]);

  useEffect(() => {
    setRunning(false);
    setSnapshot(null);
    setError('');
    setStatus('Loading physics');
    setProgress([]);
    setEvaluating(false);
    frames.current = [];
    setReplayIndex(0);
    pending.current = false;
    const current = new PhysicsWorker();
    worker.current = current;
    current.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'ready' || data.type === 'frame') {
        pending.current = false;
        setSnapshot(data.snapshot);
        frames.current.push(data.snapshot);
        setReplayIndex(frames.current.length - 1);
        if (data.machine) setMachine(data.machine);
        setStatus(
          data.type === 'ready'
            ? 'Ready'
            : data.phase === 'finished'
              ? 'Finished'
              : data.phase === 'reset'
                ? 'Reverse reset'
                : 'Running',
        );
        if (data.phase === 'finished') setRunning(false);
      } else if (data.type === 'progress')
        setProgress((currentTrials) => [...currentTrials, data.trial]);
      else if (data.type === 'evaluated') {
        setSuite(data.suite);
        setEvaluating(false);
        evaluation.current?.resolve(data.suite);
        evaluation.current = null;
      } else if (data.type === 'error') {
        setError(data.message);
        setRunning(false);
        setEvaluating(false);
        setStatus('Failed');
        pending.current = false;
        evaluation.current?.reject(new Error(data.message));
        evaluation.current = null;
      }
    };
    current.onerror = (event) => {
      setError(event.message || 'Physics worker failed');
      setRunning(false);
      setEvaluating(false);
      setStatus('Failed');
      evaluation.current?.reject(
        new Error(event.message || 'Physics worker failed'),
      );
      evaluation.current = null;
    };
    current.postMessage({
      type: 'load',
      text: machineText,
      a: inputs[0],
      b: inputs[1],
      intervention:
        intervention === 'none' || !interventionBody
          ? undefined
          : { kind: intervention, body: interventionBody },
    });
    return () => {
      current.terminate();
      worker.current = null;
      evaluation.current?.reject(new Error('Machine reloaded'));
      evaluation.current = null;
    };
  }, [machineText, inputs, intervention, interventionBody, reload]);

  useEffect(() => {
    if (snapshot) scene.current?.update(snapshot);
  }, [snapshot]);
  useEffect(() => {
    scene.current?.highlight(selected);
  }, [selected]);
  useEffect(() => {
    setSuite(null);
  }, [machineText, intervention, interventionBody]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (!pending.current && worker.current) {
        pending.current = true;
        worker.current.postMessage({
          type: 'advance',
          steps: Math.max(1, Math.round(8 * Number(speed))),
        });
      }
    }, 1000 / 30);
    return () => clearInterval(timer);
  }, [running, speed]);

  const evaluate = () =>
    new Promise<Suite>((resolve, reject) => {
      if (
        !worker.current ||
        evaluation.current ||
        !state.current.snapshot ||
        state.current.status === 'Failed'
      ) {
        reject(new Error('Wait for a valid machine to load'));
        return;
      }
      setRunning(false);
      setEvaluating(true);
      setProgress([]);
      evaluation.current = { resolve, reject };
      worker.current.postMessage({ type: 'evaluate' });
    });
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;
  useEffect(
    () =>
      registerLabTools(
        () => ({
          machine: state.current.machine,
          inputs: state.current.inputs,
          status: state.current.status,
          time: state.current.snapshot?.time,
          output: state.current.snapshot?.output,
          successes: state.current.suite?.successes,
          total: state.current.suite?.total,
        }),
        async () => {
          const result = await evaluateRef.current();
          return {
            successes: result.successes,
            total: result.total,
            trials: result.trials.map(
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

  const chooseMachine = (value: string) => {
    if (value === 'uploaded') return;
    setPreset(value);
    setSelected('');
    setIntervention('none');
    setInterventionBody('');
    setMachineText(JSON.stringify(value === 'starter' ? starter : fixture));
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > LIMITS.fileBytes) {
      setError('Machine exceeds 256 KB');
      return;
    }
    setPreset('uploaded');
    setSelected('');
    setIntervention('none');
    setInterventionBody('');
    setMachineText(await file.text());
  };
  const replay = (value: number | readonly number[]) => {
    const index = Math.round(typeof value === 'number' ? value : value[0]);
    setRunning(false);
    setReplayIndex(index);
    if (frames.current[index]) setSnapshot(frames.current[index]);
  };
  const rows = suite?.trials ?? progress;
  const disabled = !snapshot || status === 'Failed' || evaluating;

  return (
    <main className="lab">
      <header className="masthead">
        <h1>Mechanical Computer Lab</h1>
        <span>EXPERIMENT 01 / TWO-BIT ADDER</span>
      </header>
      <div className="machine-bar">
        <div className="machine-choice">
          <Choice
            label="Machine"
            value={preset}
            onChange={chooseMachine}
            choices={[
              { value: 'fixture', label: 'Physics fixture · not an adder' },
              { value: 'starter', label: 'Unsolved adder starter' },
              ...(preset === 'uploaded'
                ? [
                    {
                      value: 'uploaded',
                      label: machine?.name ?? 'Uploaded machine',
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          Load machine JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <span className="status" aria-live="polite">
          {status}
          {!running && status === 'Running' ? ' · paused' : ''}
        </span>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <section className="workbench">
        <aside className="controls">
          <h2>Inputs</h2>
          {inputs.map((value, index) => (
            <div className="input-row" key={index}>
              <label>{index === 0 ? 'A' : 'B'}</label>
              <div className="number-options">
                {[0, 1, 2, 3].map((number) => (
                  <Button
                    aria-label={`Input ${index === 0 ? 'A' : 'B'} = ${number}`}
                    aria-pressed={value === number}
                    key={number}
                    variant={value === number ? 'default' : 'outline'}
                    onClick={() =>
                      setInputs(
                        (current) =>
                          current.map((item, i) =>
                            i === index ? number : item,
                          ) as [number, number],
                      )
                    }
                  >
                    {number}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <p className="muted">
            Changing inputs reloads the machine. Persistent-cycle tests run from
            the command line.
          </p>
          <h2>Measured output · S₂ S₁ S₀</h2>
          <output className="binary" aria-label="Measured binary output">
            {snapshot?.output.binary.split('').join(' ') ?? '— — —'}
          </output>
          <div className="measurement">
            <span>Decimal</span>
            <strong>{snapshot?.output.value ?? '—'}</strong>
          </div>
          <div className="measurement">
            <span>Gauge state</span>
            <span>
              {snapshot
                ? snapshot.output.settled
                  ? 'Currently stable'
                  : 'Moving / ambiguous'
                : '—'}
            </span>
          </div>
          <p className="muted">
            Instantaneous measurement, not a pass verdict. Evaluation checks the
            full final window.
          </p>
          <h2>Playback speed</h2>
          <Choice
            label="Playback speed"
            value={speed}
            onChange={setSpeed}
            choices={[
              { value: '0.125', label: '⅛× · inspect' },
              { value: '0.25', label: '¼× · slow' },
              { value: '1', label: '1× · real time' },
              { value: '2', label: '2×' },
            ]}
          />
          <h2>Inspect a part</h2>
          <Choice
            label="Highlighted part"
            value={selected}
            onChange={setSelected}
            choices={[
              { value: '', label: 'Click a part in the viewer' },
              ...(snapshot?.bodies ?? []).map((b) => ({
                value: b.id,
                label: b.id,
              })),
            ]}
          />
          <div className="measurement telemetry">
            <span>Simulated time</span>
            <span>{snapshot?.time.toFixed(2) ?? '0.00'} s</span>
          </div>
          <div className="measurement">
            <span>Crank work</span>
            <span>{snapshot?.positiveWork.toFixed(3) ?? '0.000'} J</span>
          </div>
        </aside>
        <div className="visual-panel">
          <div ref={stage} className="stage" />
          <div className="transport">
            <Button
              disabled={disabled || status === 'Finished'}
              onClick={() => setRunning((value) => !value)}
            >
              {running ? 'Pause' : status === 'Ready' ? 'Turn crank' : 'Resume'}
            </Button>
            <Button
              disabled={disabled || running || status === 'Finished'}
              variant="outline"
              onClick={() => {
                pending.current = true;
                worker.current?.postMessage({ type: 'advance', steps: 1 });
              }}
            >
              Step
            </Button>
            <Button
              disabled={disabled}
              variant="outline"
              onClick={() => {
                worker.current?.postMessage({ type: 'reset' });
                setRunning(true);
              }}
            >
              Reverse reset
            </Button>
            <Button
              variant="ghost"
              onClick={() => setReload((value) => value + 1)}
            >
              Reload
            </Button>
            <span>2D physics · visual depth only</span>
          </div>
          <div className="replay">
            <span>Recorded playback</span>
            <Slider
              aria-label="Recorded playback"
              min={0}
              max={Math.max(1, frames.current.length - 1)}
              step={1}
              value={[replayIndex]}
              disabled={frames.current.length < 2 || running}
              onValueChange={replay}
            />
            <Button
              variant="ghost"
              disabled={frames.current.length < 2}
              onClick={() =>
                download('mechanical-trace.json', {
                  machine,
                  inputs,
                  frames: frames.current,
                })
              }
            >
              Save trace
            </Button>
          </div>
        </div>
      </section>
      <section className="evaluation">
        <div className="section-heading">
          <div>
            <h2>All 16 input pairs</h2>
            <p className="muted">
              Fresh worlds. Nominal conditions. The same loaded machine for
              every case.
            </p>
          </div>
          <Button
            disabled={disabled || evaluating}
            onClick={() => void evaluate().catch((e) => setError(String(e)))}
          >
            {evaluating ? `Testing ${progress.length}/16…` : 'Evaluate machine'}
          </Button>
        </div>
        <div className="ablation">
          <span>Causal check</span>
          <Choice
            label="Intervention"
            value={intervention}
            onChange={setIntervention}
            choices={[
              { value: 'none', label: 'Intact machine' },
              { value: 'remove', label: 'Remove component' },
              { value: 'lock', label: 'Lock component' },
            ]}
          />
          {intervention !== 'none' && (
            <Choice
              label="Intervention component"
              value={interventionBody}
              onChange={setInterventionBody}
              choices={[
                { value: '', label: 'Choose a component' },
                ...(machine?.bodies ?? []).map((body) => ({
                  value: body.id,
                  label: body.id,
                })),
              ]}
            />
          )}
        </div>
        {intervention !== 'none' && !interventionBody && (
          <p className="muted">
            No intervention applied until a component is selected.
          </p>
        )}
        {rows.length > 0 ? (
          <>
            {suite && (
              <div className="score">
                <strong>
                  {suite.successes} / {suite.total}
                </strong>
                <span>correct and stable</span>
                <Button
                  variant="ghost"
                  onClick={() => download('mechanical-evaluation.json', suite)}
                >
                  Save report
                </Button>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>A</TableHead>
                  <TableHead>B</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Measured</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Replay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((trial) => (
                  <TableRow key={`${trial.a}-${trial.b}`}>
                    <TableCell>{trial.a}</TableCell>
                    <TableCell>{trial.b}</TableCell>
                    <TableCell>{trial.expected}</TableCell>
                    <TableCell>{trial.observed ?? '—'}</TableCell>
                    <TableCell className={trial.passed ? 'pass' : 'fail'}>
                      {trial.reason}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        onClick={() => setInputs([trial.a, trial.b])}
                      >
                        Load inputs
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <p className="empty-results">
            No evaluation yet. A stationary zero output is correct for only one
            input pair.
          </p>
        )}
      </section>
      <footer>
        Ideal hinges, sliders and springs. Other interactions use contact
        geometry. No gear-ratio shortcuts. Not a fabrication claim.
      </footer>
    </main>
  );
}
