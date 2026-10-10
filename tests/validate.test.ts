import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsonErrorOffset, validateMachineText } from '../app/lib/validate';

test('editor validation locates JSON syntax errors like JSON.parse', () => {
  const cases: [string, number | undefined][] = [
    ['{"a": [1, 2,]}', 12],
    ['{"a" 1}', 5],
    ['[1, 2', 5],
    ['{"a": "x\\q"}', 9],
    ['{"a": 01}', 7],
    ['{} x', 3],
    ['', 0],
    ['[1e5, -0.5, 2E-3, true, null, false, {"x": []}]', undefined],
  ];
  for (const [text, offset] of cases)
    assert.equal(jsonErrorOffset(text), offset, text);
  assert.equal(
    jsonErrorOffset(
      readFileSync('machines/physics-fixture.machine.json', 'utf8'),
    ),
    undefined,
  );
  // Too deep to locate: no crash, no position.
  assert.equal(jsonErrorOffset('['.repeat(100_000)), undefined);

  const result = validateMachineText(
    '{\n  "version": 1,\n  "bodies": [\n  }\n}',
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.kind === 'syntax');
  assert.equal(!result.ok && result.issues[0].path, 'line 4:3');
});

test('editor validation reports schema issues with paths and the size limit', () => {
  const schema = validateMachineText(
    JSON.stringify({
      version: 1,
      name: 'x',
      bodies: [{ id: 'Bad', type: 'dynamic', position: [0, 0], shapes: [] }],
      joints: [],
      extra: 1,
    }),
  );
  assert.ok(!schema.ok && schema.kind === 'schema');
  const paths = !schema.ok ? schema.issues.map((issue) => issue.path) : [];
  assert.ok(paths.includes('bodies[0].id'), paths.join());
  assert.ok(paths.includes('bodies[0].shapes'), paths.join());

  const big = validateMachineText(' '.repeat(262_145));
  assert.ok(!big.ok && big.kind === 'size');

  const fixture = validateMachineText(
    readFileSync('machines/physics-fixture.machine.json', 'utf8'),
  );
  assert.ok(fixture.ok);
});
