import { z } from 'zod';
import { FIXTURE_IDS, INPUTS, LIMITS } from '../../simulator/protocol';
import { parseMachine, type Machine } from '../../simulator/schema';
import { pathText, type JsonPath } from './json';

export type Issue = {
  /** Display form, e.g. joints[2].b or "line 4:7". */
  path: string;
  message: string;
  /** Where the issue lives in the JSON document, when known. */
  keys?: JsonPath;
};

export type Validation =
  | { ok: true; machine: Machine; bytes: number }
  | {
      ok: false;
      kind: 'size' | 'syntax' | 'schema';
      issues: Issue[];
      bytes: number;
      /** Character offset of a JSON syntax error, when known. */
      position?: number;
    };

type Raw = {
  bodies?: { id?: unknown; shapes?: unknown }[];
  joints?: { id?: unknown; a?: unknown; b?: unknown }[];
  carryCandidates?: unknown[];
};

/**
 * The frozen schema reports cross-reference problems (duplicate IDs, unknown
 * joint endpoints, bad polygons…) at the document root, naming the part in
 * the message. Find the part the message names so the editor can point at
 * it, e.g. "rod-slider: invalid endpoints" → joints[2].b.
 */
function locateRootIssue(raw: Raw, message: string): JsonPath | undefined {
  const bodies = Array.isArray(raw.bodies) ? raw.bodies : [];
  const joints = Array.isArray(raw.joints) ? raw.joints : [];
  const carry = Array.isArray(raw.carryCandidates) ? raw.carryCandidates : [];
  const lastIndex = <T>(list: T[], match: (item: T) => boolean) => {
    for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) return i;
    return -1;
  };

  let m = /^Duplicate ID: (.+)$/.exec(message);
  if (m) {
    const id = m[1];
    const j = lastIndex(joints, (x) => x?.id === id);
    if (j >= 0) return ['joints', j, 'id'];
    const b = lastIndex(bodies, (x) => x?.id === id);
    return b >= 0 ? ['bodies', b, 'id'] : undefined;
  }
  m = /^Unknown carry component: (.+)$/.exec(message);
  if (m) {
    const id = m[1];
    const k = carry.indexOf(id);
    return k >= 0 ? ['carryCandidates', k] : ['carryCandidates'];
  }
  if (message === 'Duplicate carry component') return ['carryCandidates'];
  if (message === 'Too many colliders') return ['bodies'];

  m = /^([a-z][a-z0-9_-]*): (.+)$/.exec(message);
  if (!m) return undefined;
  const [, id, what] = m;
  const j = joints.findIndex((x) => x?.id === id);
  if (j >= 0 && /endpoints|input fixtures|limits|axis/.test(what)) {
    const joint = joints[j];
    if (what.startsWith('invalid endpoints')) {
      const known = new Set<unknown>([
        ...bodies.map((x) => x?.id),
        ...FIXTURE_IDS,
      ]);
      const end = !known.has(joint.a) ? 'a' : 'b';
      return ['joints', j, end];
    }
    if (what.startsWith('input fixtures')) {
      const inputs = new Set<unknown>(INPUTS.map((x) => x.id));
      return ['joints', j, inputs.has(joint.a) ? 'a' : 'b'];
    }
    if (what.startsWith('limits')) return ['joints', j, 'limits'];
    return ['joints', j, 'axis'];
  }
  const b = bodies.findIndex((x) => x?.id === id);
  if (b >= 0) return ['bodies', b, 'shapes'];
  return j >= 0 ? ['joints', j] : undefined;
}

class Stop {
  constructor(readonly at: number) {}
}
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /[0-9a-fA-F]{4}/y;

/** Character offset of the first JSON syntax error, or undefined when the
 * text is valid JSON (or too deeply nested to locate). Browsers do not all
 * report a position, so the editor finds it itself. */
export function jsonErrorOffset(text: string): number | undefined {
  let i = 0;
  const n = text.length;
  const fail = (at = i): never => {
    throw new Stop(Math.min(at, n));
  };
  const space = () => {
    while (i < n && ' \t\n\r'.includes(text[i])) i++;
  };
  const string = () => {
    i++;
    while (i < n) {
      const code = text.charCodeAt(i);
      if (code === 34) {
        i++;
        return;
      }
      if (code < 0x20) fail();
      if (code !== 92) {
        i++;
        continue;
      }
      const escape = text[i + 1];
      if (escape === 'u') {
        HEX4.lastIndex = i + 2;
        if (!HEX4.test(text)) fail(i + 1);
        i += 6;
      } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) i += 2;
      else fail(i + 1);
    }
    fail();
  };
  const value = (depth: number): void => {
    if (depth > 400) throw new Stop(-1);
    space();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      space();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (c === '{') {
          space();
          if (text[i] !== '"') fail();
          string();
          space();
          if (text[i] !== ':') fail();
          i++;
        }
        value(depth + 1);
        space();
        if (text[i] === ',') i++;
        else if (text[i] === close) {
          i++;
          return;
        } else fail();
      }
    }
    if (c === '"') return string();
    NUMBER.lastIndex = i;
    const number = NUMBER.exec(text);
    if (number) {
      i += number[0].length;
      return;
    }
    for (const word of ['true', 'false', 'null'])
      if (text.startsWith(word, i)) {
        i += word.length;
        return;
      }
    fail();
  };
  try {
    value(0);
    space();
    if (i < n) fail();
    return undefined;
  } catch (error) {
    if (error instanceof Stop) return error.at < 0 ? undefined : error.at;
    throw error;
  }
}

function lineColumn(text: string, position: number) {
  const before = text.slice(0, position).split('\n');
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

/** Schema-level validation with the frozen parser. Physical checks (overlap,
 * joint consistency, spring preload) only run when the world is built. */
export function validateMachineText(text: string): Validation {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.fileBytes)
    return {
      ok: false,
      kind: 'size',
      bytes,
      issues: [
        {
          path: '(file)',
          message: `${(bytes / 1000).toFixed(1)} KB exceeds the ${LIMITS.fileBytes / 1000} KB limit`,
        },
      ],
    };
  try {
    return { ok: true, machine: parseMachine(text), bytes };
  } catch (error) {
    if (error instanceof z.ZodError) {
      let raw: Raw = {};
      try {
        raw = JSON.parse(text) as Raw;
      } catch {
        // Unreachable: the schema only runs on parsed JSON.
      }
      return {
        ok: false,
        kind: 'schema',
        bytes,
        issues: error.issues.map((issue) => {
          const path = issue.path.filter(
            (key): key is string | number => typeof key !== 'symbol',
          );
          const keys = path.length
            ? path
            : (locateRootIssue(raw ?? {}, issue.message) ?? []);
          return { path: pathText(keys), message: issue.message, keys };
        }),
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof SyntaxError) {
      const match = /position (\d+)/.exec(message);
      const position = match ? Number(match[1]) : jsonErrorOffset(text);
      const where = position === undefined ? null : lineColumn(text, position);
      return {
        ok: false,
        kind: 'syntax',
        bytes,
        position,
        issues: [
          {
            path: where ? `line ${where.line}:${where.column}` : 'JSON',
            message: message
              .replace(/\s*\(line \d+ column \d+\)/, '')
              .replace(/ in JSON at position \d+/, '')
              // V8 appends a quoted excerpt; the line:column is clearer.
              .replace(/, (?:\.\.\.)?"[\s\S]*" is not valid JSON$/, '')
              .replace(
                /^Unexpected end of JSON input$/,
                'Unexpected end of input',
              ),
          },
        ],
      };
    }
    return {
      ok: false,
      kind: 'schema',
      bytes,
      issues: [{ path: '(machine)', message }],
    };
  }
}

/** One-line summary for error banners. */
export function describeInvalid(result: Validation): string {
  if (result.ok) return '';
  const [first, ...rest] = result.issues;
  const more = rest.length ? ` (+${rest.length} more)` : '';
  return result.kind === 'syntax'
    ? `Not valid JSON — ${first.message} at ${first.path}.`
    : `${first.path}: ${first.message}${more}.`;
}
