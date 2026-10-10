// Preset machines shown in the picker, bundled from machines/*.machine.json
// at build time according to the catalog (app/lib/catalog.ts).
import { CATALOG, type CatalogEntry } from './catalog';

export type Preset = Omit<CatalogEntry, 'file'> & {
  /** Raw JSON text exactly as stored in machines/. */
  text: string;
};

const files = import.meta.glob<string>('../../machines/*.machine.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const byName = new Map(
  Object.entries(files).map(([path, text]) => [path.split('/').pop()!, text]),
);

export const PRESETS: Preset[] = CATALOG.flatMap(({ file, ...entry }) => {
  const text = byName.get(file);
  return text === undefined ? [] : [{ ...entry, text }];
});

export const DEFAULT_PRESET: Preset = PRESETS[0];
if (!DEFAULT_PRESET) throw new Error('No preset machines were bundled');

export const DEFAULT_INPUTS: [number, number] = DEFAULT_PRESET.inputs ?? [3, 1];
