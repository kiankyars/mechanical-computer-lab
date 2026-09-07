import { frozenFiles, root, verifyFrozen, writeArtifact } from './artifacts';
import path from 'node:path';
import { PROTOCOL_VERSION } from '../simulator/protocol';

if (process.argv.includes('--check')) {
  await verifyFrozen();
  console.log(
    'Frozen evaluator verified. Final evaluation still requires an independently trusted checkout.',
  );
} else {
  await writeArtifact(path.join(root, 'protocol.lock.json'), {
    protocol: PROTOCOL_VERSION,
    files: await frozenFiles(),
  });
  console.log(
    'Created protocol.lock.json. Commit and externally record its hash before optimization.',
  );
}
