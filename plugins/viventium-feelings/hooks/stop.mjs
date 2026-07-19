#!/usr/bin/env node

import { handleStop } from '../runtime/hook-orchestrator.mjs';
import { resolveStateDir } from '../runtime/state-store.mjs';

const chunks = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 1_000_000) process.exit(0);
  chunks.push(chunk);
}

try {
  await handleStop({
    input: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    stateDir: resolveStateDir(),
  });
} catch {
  // Stop hooks never interfere with the host.
}
