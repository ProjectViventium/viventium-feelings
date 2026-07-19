import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  handleStop,
  handleUserPrompt,
} from '../plugins/viventium-feelings/runtime/hook-orchestrator.mjs';
import { createStateStore } from '../plugins/viventium-feelings/runtime/state-store.mjs';
import { runReactionJob } from '../plugins/viventium-feelings/runtime/reaction-worker.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-feelings-hooks-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createStateStore({ dir, now: () => new Date('2026-07-18T12:00:00.000Z') });
  return { dir, store };
}

async function allFileText(dir) {
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else output.push(await readFile(target, 'utf8').catch(() => ''));
    }
  }
  await walk(dir);
  return output.join('\n');
}

test('off state injects nothing, creates no state, and launches no reaction', async (t) => {
  const { dir, store } = await fixture(t);
  let launched = false;
  const result = await handleUserPrompt({
    input: { session_id: 'session-1', turn_id: 'turn-1', prompt: 'Hello' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { launched = true; },
  });
  assert.equal(result, null);
  assert.equal(launched, false);
  assert.equal(await store.exists(), false);
});

test('an enabled profile with every band disabled injects and appraises nothing', async (t) => {
  const { dir, store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  for (const bandId of Object.keys(state.bands)) {
    state = await store.updateBand({
      expectedVersion: state.version,
      bandId,
      patch: { enabled: false },
    });
  }
  let launched = false;
  const result = await handleUserPrompt({
    input: { session_id: 'session-none', turn_id: 'turn-none', prompt: 'Hello' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { launched = true; },
  });
  assert.equal(state.enabled, true);
  assert.equal(state.capsule, '');
  assert.equal(result, null);
  assert.equal(launched, false);
});

test('prompt orchestration deduplicates retries and queues distinct overlapping turns', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const launched = [];
  const privateStimulus = 'Synthetic praise that should never be written to disk.';
  const result = await handleUserPrompt({
    input: {
      session_id: 'session-2',
      turn_id: 'turn-2',
      prompt: privateStimulus,
    },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async (payload) => { launched.push(payload); },
  });
  assert.equal(launched.length, 1);
  assert.equal(launched[0].stimulus, privateStimulus);
  assert.equal(launched[0].baseVersion, enabled.version);
  assert.equal(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(result.hookSpecificOutput.additionalContext, enabled.capsule);
  assert.equal((await store.read()).version, enabled.version, 'current turn does not react yet');
  assert.doesNotMatch(await allFileText(dir), /Synthetic praise/u);

  await handleUserPrompt({
    input: { session_id: 'session-2', turn_id: 'turn-2', prompt: privateStimulus },
    store, stateDir: dir, host: 'codex',
    launchWorker: async (payload) => { launched.push(payload); },
  });
  await handleUserPrompt({
    input: { session_id: 'session-2', turn_id: 'turn-2b', prompt: 'A rapid second prompt.' },
    store, stateDir: dir, host: 'codex',
    launchWorker: async (payload) => { launched.push(payload); },
  });
  assert.equal(launched.length, 2, 'true retry deduplicates while a distinct overlap is queued');
});

test('reaction-gate failure never removes an already-built foreground capsule', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  let launched = false;
  const result = await handleUserPrompt({
    input: { session_id: 'session-gate-failure', turn_id: '1', prompt: 'Synthetic gate failure.' },
    store,
    stateDir: dir,
    host: 'codex',
    registerJob: async () => { throw new Error('reaction_queue_lock_timeout'); },
    launchWorker: async () => { launched = true; },
  });
  assert.equal(result.hookSpecificOutput.additionalContext, enabled.capsule);
  assert.equal(launched, false);
  assert.equal((await store.read()).version, enabled.version);
});

test('the bounded reaction queue accepts four turns and refuses unbounded worker growth', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const launched = [];
  for (let index = 1; index <= 5; index += 1) {
    await handleUserPrompt({
      input: { session_id: 'session-capacity', turn_id: String(index), prompt: `Synthetic turn ${index}.` },
      store,
      stateDir: dir,
      host: 'codex',
      launchWorker: async (payload) => { launched.push(payload); },
    });
  }
  assert.equal(launched.length, 4);
});

test('a worker launch failure clears its gate so the next turn can proceed', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  await handleUserPrompt({
    input: { session_id: 'session-launch', turn_id: '1', prompt: 'Synthetic failed launch.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { throw new Error('synthetic_spawn_failure'); },
  });
  let launched = false;
  await handleUserPrompt({
    input: { session_id: 'session-launch', turn_id: '2', prompt: 'Synthetic recovered launch.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { launched = true; },
  });
  assert.equal(launched, true);
});

test('a stale crashed-worker slot is reclaimed before accepting new work', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const jobs = path.join(dir, 'jobs');
  await mkdir(jobs, { recursive: true });
  await writeFile(path.join(jobs, '.active-reaction.json'), `${JSON.stringify({
    eventId: 'stimulus-aaaaaaaaaaaaaaaaaaaaaaaa',
    acquiredAt: '2026-07-18T00:00:00.000Z',
  })}\n`, { mode: 0o600 });
  let launched = false;
  await handleUserPrompt({
    input: { session_id: 'session-reclaim', turn_id: '1', prompt: 'Synthetic recovered work.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { launched = true; },
  });
  assert.equal(launched, true);
});

test('concurrent writers reclaim one stale queue lock without deleting a new owner', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const queueLock = path.join(dir, 'jobs', '.queue-lock');
  await mkdir(queueLock, { recursive: true });
  await writeFile(path.join(queueLock, 'owner.json'), `${JSON.stringify({
    pid: 2_147_483_647,
    token: 'stale-owner',
  })}\n`, { mode: 0o600 });
  const stale = new Date(Date.now() - 60_000);
  await utimes(queueLock, stale, stale);
  const launched = [];
  await Promise.all(Array.from({ length: 8 }, (_, index) => handleUserPrompt({
    input: {
      session_id: 'session-queue-reclaim',
      turn_id: String(index),
      prompt: `Synthetic concurrent turn ${index}.`,
    },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async (payload) => { launched.push(payload); },
  })));
  assert.equal(launched.length, 4);
  assert.equal((await readdir(path.join(dir, 'jobs'))).includes('.queue-lock'), false);
});

test('disabled reaction mode keeps the capsule but launches no worker', async (t) => {
  const { dir, store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  state = await store.updateProfile({
    expectedVersion: state.version,
    patch: { reactionActivationMode: 'disabled' },
  });
  let launched = false;
  const result = await handleUserPrompt({
    input: { session_id: 'session-disabled', turn_id: '1', prompt: 'Synthetic disabled reaction.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { launched = true; },
  });
  assert.match(result.hookSpecificOutput.additionalContext, /viventium_feeling_state/u);
  assert.equal(launched, false);
});

test('Stop only releases a pending reaction after completed assistant output', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  await handleUserPrompt({
    input: { session_id: 'session-3', turn_id: 'turn-3', prompt: 'A meaningful moment.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => {},
  });
  const incomplete = await handleStop({
    input: { session_id: 'session-3', turn_id: 'turn-3', last_assistant_message: '' },
    stateDir: dir,
    host: 'codex',
  });
  assert.equal(incomplete.signalled, false);
  const missing = await handleStop({
    input: { session_id: 'session-3', turn_id: 'turn-3' },
    stateDir: dir,
    host: 'codex',
  });
  assert.deepEqual(missing, { signalled: false, reason: 'no_completed_output' });
  const complete = await handleStop({
    input: { session_id: 'session-3', turn_id: 'turn-3', last_assistant_message: 'Visible answer.' },
    stateDir: dir,
    host: 'codex',
  });
  assert.equal(complete.signalled, true);
  assert.doesNotMatch(await allFileText(dir), /Visible answer|A meaningful moment/u);
});

test('Stop from another session cannot release a pending reaction', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  await handleUserPrompt({
    input: { session_id: 'session-a', turn_id: 'turn-a', prompt: 'Synthetic session A.' },
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => {},
  });
  const result = await handleStop({
    input: { session_id: 'session-b', turn_id: 'turn-a', last_assistant_message: 'Wrong session.' },
    stateDir: dir,
  });
  assert.deepEqual(result, { signalled: false, reason: 'no_pending_job' });
});

test('Stop without a host submission key releases the oldest matching turn', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const launched = [];
  for (const prompt of ['Synthetic oldest pending.', 'Synthetic newest pending.']) {
    await handleUserPrompt({
      input: { session_id: 'session-fifo', prompt },
      store,
      stateDir: dir,
      host: 'codex',
      launchWorker: async (payload) => { launched.push(payload); },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const released = await handleStop({
    input: { session_id: 'session-fifo', last_assistant_message: 'Synthetic answer.' },
    stateDir: dir,
  });
  assert.equal(released.eventId, launched[0].eventId);
});

test('a completed turn bypasses an older abandoned turn without violating appraisal order', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const launched = [];
  for (const turn of ['abandoned', 'completed']) {
    await handleUserPrompt({
      input: { session_id: 'session-ready-only', turn_id: turn, prompt: `Synthetic ${turn} turn.` },
      store,
      stateDir: dir,
      host: 'codex',
      launchWorker: async (payload) => { launched.push(payload); },
    });
  }
  await handleStop({
    input: {
      session_id: 'session-ready-only',
      turn_id: 'completed',
      last_assistant_message: 'Synthetic completed answer.',
    },
    stateDir: dir,
  });
  const result = await runReactionJob({
    input: launched[1],
    store,
    stateDir: dir,
    appraise: async () => ({
      changes: [{ band: 'curiosity', direction: 'up', strength: 'slight', cause: 'new_information' }],
      innerState: 'I feel the ready moment move without waiting.',
      usedHost: 'codex',
      usedModel: 'synthetic-appraiser',
      fallbackUsed: false,
    }),
  });
  assert.equal(result.status, 'applied');
  assert.equal((await store.read()).bands.curiosity.current, 69);
});

test('two completed overlapping turns appraise serially and preserve both typed changes', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const launched = [];
  for (const turn of ['1', '2']) {
    await handleUserPrompt({
      input: { session_id: 'session-overlap', turn_id: turn, prompt: `Synthetic overlap ${turn}.` },
      store,
      stateDir: dir,
      host: 'codex',
      launchWorker: async (payload) => { launched.push(payload); },
    });
    await handleStop({
      input: { session_id: 'session-overlap', turn_id: turn, last_assistant_message: `Answer ${turn}.` },
      stateDir: dir,
    });
  }
  let active = 0;
  let maxActive = 0;
  let appraisalNumber = 0;
  const appraise = async () => {
    appraisalNumber += 1;
    const currentAppraisal = appraisalNumber;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 35));
    active -= 1;
    return {
      changes: [{ band: 'mood', direction: 'up', strength: 'slight', cause: 'progress' }],
      innerState: `I feel completed moment ${currentAppraisal} register.`,
      usedHost: 'codex',
      usedModel: 'synthetic-appraiser',
      fallbackUsed: false,
    };
  };
  const results = await Promise.all(launched.map((input) => runReactionJob({
    input, store, stateDir: dir, appraise,
  })));
  assert.deepEqual(results.map((result) => result.status), ['applied', 'applied']);
  assert.equal(maxActive, 1);
  const finalState = await store.read();
  assert.equal(finalState.bands.mood.current, 64);
  assert.equal(finalState.innerState.text, 'I feel completed moment 2 register.');
  assert.doesNotMatch(await allFileText(dir), /Synthetic overlap|Answer [12]/u);
});

test('replaying an already committed host event launches no second paid appraisal', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const hostInput = {
    session_id: 'session-replay',
    turn_id: 'turn-replay',
    prompt: 'Synthetic committed replay.',
  };
  const launched = [];
  await handleUserPrompt({
    input: hostInput,
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async (payload) => { launched.push(payload); },
  });
  await handleStop({
    input: { ...hostInput, last_assistant_message: 'Synthetic completed output.' },
    stateDir: dir,
  });
  const first = await runReactionJob({
    input: launched[0],
    store,
    stateDir: dir,
    appraise: async () => ({
      changes: [{ band: 'mood', direction: 'up', strength: 'slight', cause: 'progress' }],
      innerState: 'I feel this single appraisal land.',
      usedHost: 'codex',
      usedModel: 'synthetic-appraiser',
      fallbackUsed: false,
    }),
  });
  assert.equal(first.status, 'applied');

  let replayLaunches = 0;
  await handleUserPrompt({
    input: hostInput,
    store,
    stateDir: dir,
    host: 'codex',
    launchWorker: async () => { replayLaunches += 1; },
  });
  assert.equal(replayLaunches, 0);
  assert.equal((await store.read()).processedStimulusKeys.length, 1);
  assert.doesNotMatch(await allFileText(dir), /Synthetic committed replay|Synthetic completed output/u);
});

test('reaction worker updates only after completion and preserves future-turn causality', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const input = {
    eventId: 'stimulus-555555555555555555555555',
    sessionId: 'session-4',
    sequence: 1,
    launchedAt: '2026-07-18T12:00:00.000Z',
    baseVersion: enabled.version,
    baseControlEpoch: enabled.controlEpoch,
    host: 'codex',
    stimulus: 'A meaningful synthetic success.',
  };
  let released = false;
  const job = runReactionJob({
    input,
    store,
    stateDir: dir,
    waitForCompletion: async () => {
      assert.equal((await store.read()).bands.mood.current, 58);
      released = true;
      return true;
    },
    acquireAppraisal: async () => true,
    appraise: async () => ({
      changes: [{ band: 'mood', direction: 'up', strength: 'clear', cause: 'progress' }],
      innerState: 'I feel the success land and want to keep moving.',
      usedHost: 'codex',
      usedModel: 'synthetic-appraiser',
      fallbackUsed: false,
    }),
  });
  const result = await job;
  assert.equal(released, true);
  assert.equal(result.status, 'applied');
  assert.equal((await store.read()).bands.mood.current, 66);
  assert.doesNotMatch(await allFileText(dir), /meaningful synthetic success/u);
});

test('completion timeout skips and appraiser failure degrades safely without a retry or affect change', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const baseInput = {
    sessionId: 'session-degraded',
    sequence: 1,
    launchedAt: '2026-07-18T12:00:00.000Z',
    baseVersion: enabled.version,
    baseControlEpoch: enabled.controlEpoch,
    host: 'codex',
    stimulus: 'Synthetic unavailable-provider case.',
  };

  const timeout = await runReactionJob({
    input: { ...baseInput, eventId: 'stimulus-666666666666666666666666' },
    store,
    stateDir: dir,
    waitForCompletion: async () => false,
    appraise: async () => { throw new Error('must_not_run'); },
  });
  assert.deepEqual(timeout, { status: 'skipped', reason: 'completion_timeout' });
  assert.equal((await store.read()).reactionHealth.lastSkipReason, 'completion_timeout');

  let attempts = 0;
  const failed = await runReactionJob({
    input: { ...baseInput, eventId: 'stimulus-777777777777777777777777' },
    store,
    stateDir: dir,
    waitForCompletion: async () => true,
    acquireAppraisal: async () => true,
    appraise: async () => {
      attempts += 1;
      const error = new Error('provider_auth_missing');
      error.code = 'provider_auth_missing';
      throw error;
    },
  });
  const final = await store.read();
  assert.deepEqual(failed, { status: 'failed', reason: 'appraisal_failed' });
  assert.equal(attempts, 1);
  assert.equal(final.version, enabled.version);
  assert.equal(final.bands.mood.current, enabled.bands.mood.current);
  assert.equal(final.reactionHealth.status, 'degraded');
  assert.equal(final.reactionHealth.lastErrorClass, 'provider_auth_missing');
  assert.doesNotMatch(await allFileText(dir), /unavailable-provider/u);
});

test('completion-gate filesystem errors degrade with fixed health and still clear the job', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const eventId = 'stimulus-121212121212121212121212';
  const result = await runReactionJob({
    input: {
      eventId,
      sessionId: 'session-coordination-error',
      sequence: 1,
      launchedAt: '2026-07-18T12:00:00.000Z',
      baseVersion: enabled.version,
      baseControlEpoch: enabled.controlEpoch,
      host: 'codex',
      stimulus: 'Synthetic coordination error.',
    },
    store,
    stateDir: dir,
    waitForCompletion: async () => {
      const error = new Error('private filesystem prose must not persist');
      error.code = 'EACCES';
      throw error;
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'appraisal_failed' });
  const final = await store.read();
  assert.equal(final.reactionHealth.lastErrorClass, 'reaction_coordination_failed');
  assert.doesNotMatch(await allFileText(dir), /private filesystem prose|Synthetic coordination error/u);
});

test('a mid-appraisal control change ends in a truthful skipped health state', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const result = await runReactionJob({
    input: {
      eventId: 'stimulus-888888888888888888888888',
      sessionId: 'session-control-change',
      sequence: 1,
      launchedAt: '2026-07-18T12:00:00.000Z',
      baseVersion: enabled.version,
      baseControlEpoch: enabled.controlEpoch,
      host: 'codex',
      stimulus: 'Synthetic control-change case.',
    },
    store,
    stateDir: dir,
    waitForCompletion: async () => true,
    acquireAppraisal: async () => true,
    appraise: async () => {
      const latest = await store.read();
      await store.updateBand({
        expectedVersion: latest.version,
        bandId: 'care',
        patch: { current: 50 },
      });
      return {
        changes: [{ band: 'care', direction: 'up', strength: 'strong', cause: 'care_signal' }],
        innerState: 'This old appraisal must not overwrite the new control.',
        usedHost: 'codex',
        usedModel: 'synthetic-appraiser',
        fallbackUsed: false,
      };
    },
  });
  const final = await store.read();
  assert.equal(result.status, 'cancelled_by_control');
  assert.equal(final.bands.care.current, 50);
  assert.equal(final.reactionHealth.status, 'skipped');
  assert.equal(final.reactionHealth.lastSkipReason, 'cancelled_by_control');
});

test('hook config registers exactly one command per lifecycle event', async () => {
  const file = path.resolve(import.meta.dirname, '../plugins/viventium-feelings/hooks/hooks.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  assert.equal(config.hooks.UserPromptSubmit[0].hooks.length, 1);
  assert.equal(config.hooks.Stop.length, 1);
  assert.equal(config.hooks.Stop[0].hooks.length, 1);
});
