#!/usr/bin/env node

import { handleUserPrompt } from '../runtime/hook-orchestrator.mjs';
import { createStateStore, resolveHost, resolveStateDir } from '../runtime/state-store.mjs';

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1_000_000) process.exit(0);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try {
  const stateDir = resolveStateDir();
  const result = await handleUserPrompt({
    input: await readInput(),
    store: createStateStore({ dir: stateDir, lockWaitMs: 750 }),
    stateDir,
    host: resolveHost(),
  });
  if (result) process.stdout.write(JSON.stringify(result));
} catch {
  // Feelings fail open: the host's main response must remain available.
}
