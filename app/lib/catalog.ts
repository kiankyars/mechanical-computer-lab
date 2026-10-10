// The preset catalog: plain data with no bundler APIs, so tests can check
// what the gallery claims about each machine (tests/presets.test.ts).
//
// Presets are shown in this order and the FIRST one whose file exists is the
// page default. A catalog entry whose file does not exist yet is skipped, so
// adding a machine is one entry here plus machines/<file>.

export type PresetRole =
  /** Presented as a working adder: must score 16/16 nominal (tested). */
  | 'adder'
  /** A physics positive control: moves, but does not add. */
  | 'control'
  /** The unsolved task. */
  | 'starter';

export type CatalogEntry = {
  id: string;
  file: string;
  title: string;
  blurb: string;
  role: PresetRole;
  /** Shown beside the measured sum so a non-adder is never mistaken for one. */
  note?: string;
  /** Turn the crank once after the page's first load (never under reduced
   * motion, and only for the page default). */
  autoplay?: boolean;
  /** Inputs selected when the preset loads as the page default. */
  inputs?: [number, number];
};

export const CATALOG: CatalogEntry[] = [
  {
    id: 'reference-adder',
    file: 'reference-adder.machine.json',
    title: 'Reference adder',
    blurb:
      'Feasibility witness designed by Claude agents with simulator feedback · not a benchmark result',
    role: 'adder',
    autoplay: true,
    inputs: [3, 1],
  },
  {
    id: 'physics-fixture',
    file: 'physics-fixture.machine.json',
    title: 'Slider-crank',
    blurb: 'Physics positive control, not an adder',
    role: 'control',
    note: 'Physics control — not an adder',
    autoplay: true,
    inputs: [3, 1],
  },
  {
    id: 'starter',
    file: 'starter.machine.json',
    title: 'Empty starter',
    blurb: 'The unsolved task: no parts, every gauge stays at zero',
    role: 'starter',
    note: 'Empty starter — nothing to compute with yet',
    inputs: [3, 1],
  },
];
