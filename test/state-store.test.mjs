import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ConflictError,
  createStateStore,
  resolveStateDir,
} from '../plugins/viventium-feelings/runtime/state-store.mjs';
import { eventIdFor } from '../plugins/viventium-feelings/runtime/event-id.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-feelings-store-test-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });
  let clock = new Date('2026-07-18T12:00:00.000Z');
  return {
    dir,
    store: createStateStore({ dir, now: () => new Date(clock) }),
    setClock(value) { clock = new Date(value); },
  };
}

test('missing state reads default-off without creating a file', async (t) => {
  const { dir, store } = await fixture(t);
  const state = await store.read();
  assert.equal(state.enabled, false);
  assert.equal(state.version, 0);
  assert.equal(state.capsule, '');
  await assert.rejects(access(path.join(dir, 'state.json')));
});

test('Codex MCP fallback resolves to the same native plugin-data contract as hooks', async (t) => {
  const { dir } = await fixture(t);
  const previous = {
    host: process.env.VIVENTIUM_FEELINGS_HOST,
    codexHome: process.env.CODEX_HOME,
    pluginData: process.env.PLUGIN_DATA,
    claudeData: process.env.CLAUDE_PLUGIN_DATA,
  };
  process.env.VIVENTIUM_FEELINGS_HOST = 'codex';
  process.env.CODEX_HOME = dir;
  delete process.env.PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    assert.equal(resolveStateDir(), path.join(dir, 'plugins', 'data', 'viventium-feelings-project-viventium'));
  } finally {
    for (const [key, value] of [
      ['VIVENTIUM_FEELINGS_HOST', previous.host],
      ['CODEX_HOME', previous.codexHome],
      ['PLUGIN_DATA', previous.pluginData],
      ['CLAUDE_PLUGIN_DATA', previous.claudeData],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('installed Codex MCP derives its isolated home from the plugin cache root', async (t) => {
  const { dir } = await fixture(t);
  const previous = {
    host: process.env.VIVENTIUM_FEELINGS_HOST,
    codexHome: process.env.CODEX_HOME,
    pluginData: process.env.PLUGIN_DATA,
    claudeData: process.env.CLAUDE_PLUGIN_DATA,
  };
  process.env.VIVENTIUM_FEELINGS_HOST = 'codex';
  delete process.env.CODEX_HOME;
  delete process.env.PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  const installedRoot = path.join(
    dir,
    'plugins',
    'cache',
    'project-viventium',
    'viventium-feelings',
    '0.1.0',
  );
  try {
    assert.equal(
      resolveStateDir({ cwd: installedRoot }),
      path.join(dir, 'plugins', 'data', 'viventium-feelings-project-viventium'),
    );
  } finally {
    for (const [key, value] of [
      ['VIVENTIUM_FEELINGS_HOST', previous.host],
      ['CODEX_HOME', previous.codexHome],
      ['PLUGIN_DATA', previous.pluginData],
      ['CLAUDE_PLUGIN_DATA', previous.claudeData],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Claude MCP and hooks share the native config plugin-data directory', async (t) => {
  const { dir } = await fixture(t);
  const previous = {
    host: process.env.VIVENTIUM_FEELINGS_HOST,
    configDir: process.env.CLAUDE_CONFIG_DIR,
    pluginData: process.env.PLUGIN_DATA,
    claudeData: process.env.CLAUDE_PLUGIN_DATA,
  };
  process.env.VIVENTIUM_FEELINGS_HOST = 'claude';
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '${CLAUDE_PLUGIN_DATA}';
  try {
    assert.equal(
      resolveStateDir(),
      path.join(dir, 'plugins', 'data', 'viventium-feelings-project-viventium'),
    );
  } finally {
    for (const [key, value] of [
      ['VIVENTIUM_FEELINGS_HOST', previous.host],
      ['CLAUDE_CONFIG_DIR', previous.configDir],
      ['PLUGIN_DATA', previous.pluginData],
      ['CLAUDE_PLUGIN_DATA', previous.claudeData],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('explicit enable creates user-only state and pause injects nothing', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.capsule.includes('<viventium_feeling_state>'));
  const stateMode = (await stat(path.join(dir, 'state.json'))).mode & 0o777;
  const dirMode = (await stat(dir)).mode & 0o777;
  assert.equal(stateMode, 0o600);
  assert.equal(dirMode, 0o700);
  const paused = await store.setEnabled({ expectedVersion: enabled.version, enabled: false });
  assert.equal(paused.capsule, '');
  assert.equal(paused.reactionHealth.status, 'skipped');
  assert.equal(paused.reactionHealth.lastSkipReason, 'disabled');
  const resumed = await store.setEnabled({ expectedVersion: paused.version, enabled: true });
  assert.equal(resumed.reactionHealth.status, 'never');
  assert.equal(resumed.reactionHealth.lastSkipReason, null);
});

test('erase is durable across the next read and a new store instance', async (t) => {
  const { dir, store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await eventIdFor({ session_id: 'synthetic-session', prompt_id: 'synthetic-prompt' }, { dir });
  await store.erase({ expectedVersion: enabled.version });
  assert.equal((await store.read()).enabled, false);
  assert.equal((await createStateStore({ dir }).read()).enabled, false);
  await assert.rejects(access(path.join(dir, 'state.json')));
  await assert.rejects(access(path.join(dir, '.event-key')));
});

test('off state still decays on read but remains absent from prompt context', async (t) => {
  const { store, setClock } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'energy',
    patch: { baseline: 50, current: 100, halfLifeMinutes: 60 },
  });
  state = await store.setEnabled({ expectedVersion: state.version, enabled: false });
  setClock('2026-07-18T13:00:00.000Z');
  const read = await store.read();
  assert.equal(read.bands.energy.current, 75);
  assert.equal(read.capsule, '');
});

test('version preconditions reject stale dashboard writes', async (t) => {
  const { store } = await fixture(t);
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await assert.rejects(
    store.updateBand({ expectedVersion: 0, bandId: 'mood', patch: { current: 90 } }),
    ConflictError,
  );
  assert.equal((await store.read()).version, enabled.version);
});

test('reaction commit rebases typed changes, deduplicates, and protects stale Inner state', async (t) => {
  const { store } = await fixture(t);
  const started = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const first = await store.commitReaction({
    eventId: 'stimulus-111111111111111111111111',
    baseVersion: started.version,
    baseControlEpoch: started.controlEpoch,
    changes: [{ band: 'mood', direction: 'up', strength: 'clear', cause: 'praise' }],
    innerState: 'I feel a clean lift and want to meet it openly.',
    health: { usedHost: 'codex', durationMs: 1200 },
  });
  assert.equal(first.status, 'applied');
  assert.equal(first.state.bands.mood.current, 66);
  assert.equal(first.state.innerState.text, 'I feel a clean lift and want to meet it openly.');
  const duplicate = await store.commitReaction({
    eventId: 'stimulus-111111111111111111111111',
    baseVersion: started.version,
    baseControlEpoch: started.controlEpoch,
    changes: [{ band: 'mood', direction: 'up', strength: 'strong', cause: 'praise' }],
    innerState: 'This duplicate must never land.',
    health: { usedHost: 'codex', durationMs: 10 },
  });
  assert.equal(duplicate.status, 'duplicate');

  const stale = await store.commitReaction({
    eventId: 'stimulus-222222222222222222222222',
    baseVersion: started.version,
    baseControlEpoch: started.controlEpoch,
    changes: [{ band: 'play', direction: 'up', strength: 'slight', cause: 'playful_exchange' }],
    innerState: 'This stale line must not replace the current one.',
    health: { usedHost: 'codex', durationMs: 800 },
  });
  assert.equal(stale.status, 'applied');
  assert.equal(stale.rebased, true);
  assert.equal(stale.state.bands.play.current, 51);
  assert.equal(stale.state.innerState.text, 'I feel a clean lift and want to meet it openly.');
});

test('control epoch prevents an old worker overwriting pause, reset, or manual edits', async (t) => {
  const { store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const workerEpoch = state.controlEpoch;
  const workerVersion = state.version;
  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'connection',
    patch: { current: 10 },
  });
  const result = await store.commitReaction({
    eventId: 'stimulus-333333333333333333333333',
    baseVersion: workerVersion,
    baseControlEpoch: workerEpoch,
    changes: [{ band: 'connection', direction: 'up', strength: 'strong', cause: 'connection_bid' }],
    innerState: 'Old work should not overwrite a manual control.',
    health: { usedHost: 'claude', durationMs: 500 },
  });
  assert.equal(result.status, 'cancelled_by_control');
  assert.equal((await store.read()).bands.connection.current, 10);
});

test('erase during appraisal leaves state absent and cancels the stale commit', async (t) => {
  const { store } = await fixture(t);
  const started = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await store.erase({ expectedVersion: started.version });
  const result = await store.commitReaction({
    eventId: 'stimulus-999999999999999999999999',
    baseVersion: started.version,
    baseControlEpoch: started.controlEpoch,
    changes: [{ band: 'mood', direction: 'up', strength: 'strong', cause: 'praise' }],
    innerState: 'This erased reaction must never return.',
    health: { usedHost: 'codex', durationMs: 500 },
  });
  assert.equal(result.status, 'cancelled_by_control');
  assert.equal(await store.exists(), false);
});

test('manual state changes clear stale Inner state and append bounded typed trail only', async (t) => {
  const { dir, store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  state = (await store.commitReaction({
    eventId: 'stimulus-444444444444444444444444',
    baseVersion: state.version,
    baseControlEpoch: state.controlEpoch,
    changes: [{ band: 'care', direction: 'up', strength: 'slight', cause: 'care_signal' }],
    innerState: 'I want to tend this carefully.',
    health: { usedHost: 'claude', durationMs: 400 },
  })).state;
  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'care',
    patch: { current: 40 },
  });
  assert.equal(state.innerState, null);
  assert.equal(state.trail.at(-1).cause, 'manual_adjustment');
  const persisted = await readFile(path.join(dir, 'state.json'), 'utf8');
  assert.doesNotMatch(persisted, /I want to tend this carefully/u);
});

test('atomic stale-lock reclamation permits only one expected-version writer', async (t) => {
  const { dir } = await fixture(t);
  await mkdir(path.join(dir, '.state.lock'));
  const stale = new Date(Date.now() - 60_000);
  await utimes(path.join(dir, '.state.lock'), stale, stale);
  const first = createStateStore({ dir });
  const second = createStateStore({ dir });
  const results = await Promise.allSettled([
    first.setEnabled({ expectedVersion: 0, enabled: true }),
    second.setEnabled({ expectedVersion: 0, enabled: false }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictError).length, 1);
  assert.equal((await first.read()).version, 1);
});

test('a stale-looking lock owned by a live process is never reclaimed', async (t) => {
  const { dir } = await fixture(t);
  const lock = path.join(dir, '.state.lock');
  await mkdir(lock);
  await writeFile(path.join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`, { mode: 0o600 });
  const stale = new Date(Date.now() - 60_000);
  await utimes(lock, stale, stale);
  const store = createStateStore({ dir, lockWaitMs: 60 });
  await assert.rejects(
    store.setEnabled({ expectedVersion: 0, enabled: true }),
    /state_lock_timeout/u,
  );
  assert.equal(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8')).pid, process.pid);
});

test('capsule limit rejects an oversized future range before persistence', async (t) => {
  const { store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const beforeVersion = state.version;
  await assert.rejects(store.updateBand({
    expectedVersion: state.version,
    bandId: 'energy',
    patch: { rangePromptOverride: { levelId: 'level_4', instruction: 'x'.repeat(1000) } },
  }), /capsule_limit/u);
  assert.equal((await store.read()).version, beforeVersion);
});

test('legacy capsule overflow after drift degrades to the built-in frame without breaking reads', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const file = path.join(dir, 'state.json');
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  persisted.rangePromptOverrides.energy = { level_4: 'x'.repeat(1000) };
  persisted.bands.energy.current = 85;
  await writeFile(file, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });

  const recovered = await store.read();
  assert.equal(recovered.enabled, true);
  assert.match(recovered.capsule, /energy:/u);
  assert.doesNotMatch(recovered.capsule, /x{100}/u);
  assert.equal(recovered.reactionHealth.status, 'degraded');
  assert.equal(recovered.reactionHealth.lastErrorClass, 'capsule_limit');
  assert.equal((await readdir(dir)).some((name) => name.startsWith('state.corrupt.')), false);
});

test('all five range additions update atomically and null restores the built-in text', async (t) => {
  const { store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'mood',
    patch: {
      rangePromptOverrides: {
        level_0: 'Let the heaviness narrow what feels possible.',
        level_1: null,
        level_2: 'Keep the emotional center level and unforced.',
        level_3: null,
        level_4: 'Let delight become difficult to hide.',
      },
    },
  });
  assert.deepEqual(state.rangePromptOverrides.mood, {
    level_0: 'Let the heaviness narrow what feels possible.',
    level_2: 'Keep the emotional center level and unforced.',
    level_4: 'Let delight become difficult to hide.',
  });

  const beforeVersion = state.version;
  await assert.rejects(store.updateBand({
    expectedVersion: state.version,
    bandId: 'mood',
    patch: { rangePromptOverrides: { level_0: 'valid', not_a_level: 'invalid' } },
  }), /validation_error|range_override_invalid/u);
  assert.equal((await store.read()).version, beforeVersion);

  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'mood',
    patch: { rangePromptOverrides: { level_0: null, level_2: null, level_4: null } },
  });
  assert.equal(state.rangePromptOverrides.mood, undefined);
});

test('corrupt state is quarantined and recovers to absent default-off state', async (t) => {
  const { dir, store } = await fixture(t);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'state.json'), '{not valid json', { mode: 0o600 });
  const state = await store.read();
  assert.equal(state.enabled, false);
  assert.equal(state.version, 0);
  assert.equal(state.capsule, '');
  const entries = await readdir(dir);
  assert.ok(entries.some((name) => name.startsWith('state.corrupt.') && name.endsWith('.json')));
  await assert.rejects(access(path.join(dir, 'state.json')));
  await store.erase({ expectedVersion: 0 });
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith('state.corrupt.')));
});

test('untyped reaction health is quarantined instead of reaching the dashboard', async (t) => {
  const { dir, store } = await fixture(t);
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  const file = path.join(dir, 'state.json');
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  persisted.reactionHealth.lastUsedModel = { untrusted: true };
  await writeFile(file, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });

  const recovered = await store.read();
  assert.equal(recovered.enabled, false);
  assert.equal(recovered.reactionHealth.status, 'never');
  assert.ok((await readdir(dir)).some((name) => name.startsWith('state.corrupt.')));
});

test('unknown trail causes and nonnumeric trail values are quarantined', async (t) => {
  const { dir, store } = await fixture(t);
  let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
  state = await store.updateBand({
    expectedVersion: state.version,
    bandId: 'energy',
    patch: { current: 70 },
  });
  const file = path.join(dir, 'state.json');
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  persisted.trail[0].cause = '<script>not-a-cause</script>';
  persisted.trail[0].before = '56';
  await writeFile(file, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });

  const recovered = await store.read();
  assert.equal(recovered.enabled, false);
  assert.deepEqual(recovered.trail, []);
  assert.ok((await readdir(dir)).some((name) => name.startsWith('state.corrupt.')));
});
