#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appraiseStimulus } from '../../plugins/viventium-feelings/runtime/appraiser.mjs';
import { createStateStore } from '../../plugins/viventium-feelings/runtime/state-store.mjs';

async function run(host) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `viventium-${host}-live-smoke-`));
  try {
    const store = createStateStore({ dir });
    const state = await store.setEnabled({ expectedVersion: 0, enabled: true });
    const started = Date.now();
    const result = await appraiseStimulus({
      host,
      state,
      stimulus: 'Synthetic QA: we found and fixed a real refresh bug, and the complete test suite now passes.',
    });
    return {
      host,
      status: 'PASS',
      durationMs: Date.now() - started,
      changeCount: result.changes.length,
      changes: result.changes,
      innerStateLength: result.innerState.length,
      usedModel: result.usedModel,
      fallbackUsed: result.fallbackUsed,
    };
  } catch (error) {
    return {
      host,
      status: 'FAIL',
      errorCode: String(error?.code ?? error?.message ?? 'unknown').slice(0, 120),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const results = await Promise.all(['claude', 'codex'].map(run));
process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
