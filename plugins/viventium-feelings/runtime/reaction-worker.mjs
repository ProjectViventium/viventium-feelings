#!/usr/bin/env node

import { acquireAppraisalSlot, clearJob, waitForCompleted } from './completion-gate.mjs';
import { createStateStore, resolveStateDir } from './state-store.mjs';

const MAX_STDIN_BYTES = 128_000;

function fixedFailureCode(error, phase) {
  const code = String(error?.code ?? '');
  if (/^[a-z][a-z0-9_]{0,119}$/u.test(code)) return code;
  return phase === 'appraisal' ? 'appraisal_failed'
    : phase === 'commit' ? 'reaction_commit_failed'
      : 'reaction_coordination_failed';
}

async function defaultAppraise() {
  const { appraiseStimulus } = await import('./appraiser.mjs');
  return appraiseStimulus(...arguments);
}

export async function runReactionJob({
  input,
  store = createStateStore(),
  stateDir = resolveStateDir(),
  waitForCompletion = () => waitForCompleted({ stateDir, eventId: input.eventId }),
  acquireAppraisal = () => acquireAppraisalSlot({ stateDir, eventId: input.eventId }),
  appraise = defaultAppraise,
}) {
  const startedAt = Date.now();
  let phase = 'completion_gate';
  try {
    const released = await waitForCompletion();
    if (!released) {
      await store.recordReactionHealth({
        status: 'skipped',
        skipReason: 'completion_timeout',
        requestedHost: input.host,
      });
      return { status: 'skipped', reason: 'completion_timeout' };
    }
    phase = 'appraisal_queue';
    const acquired = await acquireAppraisal();
    if (!acquired) {
      await store.recordReactionHealth({
        status: 'degraded',
        errorCode: 'reaction_queue_timeout',
        requestedHost: input.host,
      });
      return { status: 'skipped', reason: 'reaction_queue_timeout' };
    }
    await store.recordReactionHealth({ status: 'running', requestedHost: input.host });
    const state = await store.read();
    if (!state.enabled || state.controlEpoch !== input.baseControlEpoch) {
      await store.recordReactionHealth({
        status: 'skipped',
        skipReason: 'cancelled_by_control',
        requestedHost: input.host,
      });
      return { status: 'cancelled_by_control' };
    }
    phase = 'appraisal';
    const appraisal = await appraise({ stimulus: input.stimulus, state, host: input.host });
    phase = 'commit';
    const result = await store.commitReaction({
      eventId: input.eventId,
      // The queue serializes appraisals, so commit against the exact state this
      // appraisal saw. The prompt-time control epoch remains the cancellation
      // barrier for any intervening user control or erase operation.
      baseVersion: state.version,
      baseControlEpoch: input.baseControlEpoch,
      changes: appraisal.changes,
      innerState: appraisal.innerState,
      health: {
        durationMs: Date.now() - startedAt,
        requestedHost: input.host,
        usedHost: appraisal.usedHost,
        usedModel: appraisal.usedModel,
        fallbackUsed: appraisal.fallbackUsed,
      },
    });
    if (result.status === 'duplicate' || result.status === 'cancelled_by_control') {
      await store.recordReactionHealth({
        status: 'skipped',
        skipReason: result.status,
        requestedHost: input.host,
      });
    }
    return result;
  } catch (error) {
    await store.recordReactionHealth({
      status: 'degraded',
      errorCode: fixedFailureCode(error, phase),
      requestedHost: input.host,
    }).catch(() => {});
    return { status: 'failed', reason: 'appraisal_failed' };
  } finally {
    await clearJob({ stateDir, eventId: input.eventId });
  }
}

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_STDIN_BYTES) throw new Error('input_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const input = await readInput();
  await runReactionJob({ input });
}
