// JSON helpers for the machine editor: a compact pretty-printer in the style
// of the bundled presets, and a locator that maps a JSON path (as reported by
// schema validation) to a character range in the text.

export type JsonPath = readonly (string | number)[];

/** Width of an ordinary line (object properties, nested values). */
const WIDTH = 100;
/** Width allowed for one element of a list, so each body / joint / shape
 * stays a single readable record line, as in machines/*.machine.json. */
const RECORD_WIDTH = 180;

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }`;
  }
  return JSON.stringify(value) ?? 'null';
}

function print(value: unknown, indent: string, room: number): string {
  const flat = inline(value);
  if (value === null || typeof value !== 'object' || flat.length <= room)
    return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return `[\n${value
      .map((item) => inner + print(item, inner, RECORD_WIDTH - inner.length))
      .join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value)
    .map(([key, item]) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return head + print(item, inner, WIDTH - head.length);
    })
    .join(',\n')}\n${indent}}`;
}

/** Pretty-prints JSON the way the presets are written: one line per body,
 * joint or shape, coordinate pairs kept together, long values wrapped. */
export function formatJson(value: unknown): string {
  return `${print(value, '', WIDTH)}\n`;
}

/** Display form of a path: bodies[1].shapes[0].half */
export const pathText = (path: JsonPath) =>
  path.reduce<string>(
    (out, key) =>
      typeof key === 'number'
        ? `${out}[${key}]`
        : `${out}${out ? '.' : ''}${String(key)}`,
    '',
  ) || '(root)';

/**
 * Character range [start, end) of the value at `path` in JSON `text`. When
 * the path does not exist all the way down (e.g. a missing key), the deepest
 * existing ancestor is returned; for an object key, the range covers the key
 * and its value. Returns undefined when the text is not valid JSON.
 */
export function locateJsonPath(
  text: string,
  path: JsonPath,
): { start: number; end: number } | undefined {
  let i = 0;
  const n = text.length;
  const space = () => {
    while (i < n && ' \t\n\r'.includes(text[i])) i++;
  };
  const skipString = () => {
    i++;
    while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
  };
  /** Skips one value; returns its end offset. */
  const skip = (): number => {
    space();
    const c = text[i];
    if (c === '"') skipString();
    else if (c === '{' || c === '[') {
      let depth = 0;
      while (i < n) {
        const d = text[i];
        if (d === '"') {
          skipString();
          continue;
        }
        if (d === '{' || d === '[') depth++;
        else if (d === '}' || d === ']') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
    } else while (i < n && !',}] \t\n\r'.includes(text[i])) i++;
    return i;
  };

  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  space();
  let found = { start: i, end: n };
  for (const key of path) {
    space();
    const open = text[i];
    let hit = false;
    if (open === '{' && typeof key === 'string') {
      i++;
      for (;;) {
        space();
        if (text[i] === '}') break;
        const keyStart = i;
        skipString();
        const name = JSON.parse(text.slice(keyStart, i)) as string;
        space();
        i++; // ':'
        space();
        const valueStart = i;
        const valueEnd = skip();
        if (name === key) {
          found = { start: keyStart, end: valueEnd };
          i = valueStart;
          hit = true;
          break;
        }
        space();
        if (text[i] === ',') i++;
      }
    } else if (open === '[' && typeof key === 'number') {
      i++;
      for (let index = 0; ; index++) {
        space();
        if (text[i] === ']') break;
        const valueStart = i;
        const valueEnd = skip();
        if (index === key) {
          found = { start: valueStart, end: valueEnd };
          i = valueStart;
          hit = true;
          break;
        }
        space();
        if (text[i] === ',') i++;
      }
    }
    if (!hit) break;
  }
  return found;
}
