import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { decodeMachine, encodeMachine, machinePayload } from '../app/lib/share';

const fixture = readFileSync('machines/physics-fixture.machine.json', 'utf8');

test('share links round-trip a machine through the URL fragment', async () => {
  const fragment = await encodeMachine(fixture);
  assert.match(fragment, /^m=[A-Za-z0-9_-]+$/);
  const payload = machinePayload(`#${fragment}`);
  assert.ok(payload);
  assert.deepEqual(
    JSON.parse(await decodeMachine(payload)),
    JSON.parse(fixture),
  );
  assert.equal(machinePayload('#other=1'), null);
});

test('share links reject garbage and payloads that inflate past 256 KB', async () => {
  await assert.rejects(decodeMachine('not base64!'));
  await assert.rejects(decodeMachine('AAAA'));
  await assert.rejects(decodeMachine(''));
  await assert.rejects(encodeMachine(`"${'x'.repeat(260_000)}"`), /256 KB/);
  const bomb = deflateRawSync(Buffer.from(' '.repeat(300_000))).toString(
    'base64url',
  );
  assert.ok(bomb.length < 2000);
  await assert.rejects(decodeMachine(bomb), /256 KB/);
});
