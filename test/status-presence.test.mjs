import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStateStore } from '../plugins/viventium-feelings/runtime/state-store.mjs';
import {
  StatusPresenceError,
  disableStatusPresence,
  enableStatusPresence,
  getStatusPresence,
} from '../plugins/viventium-feelings/runtime/status-presence.mjs';

function runStatusCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const errors = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString('utf8')));
      resolve(Buffer.concat(output).toString('utf8'));
    });
    child.stdin.end('{"model":{"display_name":"Synthetic"}}');
  });
}

test('Claude status presence is explicit, live, and removes only its owned setting', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir: stateDir });
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  assert.equal((await getStatusPresence({ host: 'claude', configDir, stateDir })).status, 'available');
  const enabled = await enableStatusPresence({ host: 'claude', configDir, stateDir });
  assert.equal(enabled.status, 'enabled');
  const settings = JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8'));
  assert.equal(settings.statusLine.type, 'command');
  assert.equal(settings.statusLine.refreshInterval, 2);
  assert.match(await runStatusCommand(settings.statusLine.command), /^V Feelings · On · waiting\n$/u);
  await disableStatusPresence({ host: 'claude', configDir, stateDir });
  const disabledSettings = JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8'));
  assert.equal(disabledSettings.statusLine, undefined);
  await assert.rejects(lstat(path.join(configDir, 'viventium-feelings', 'statusline.mjs')), { code: 'ENOENT' });
});

test('Claude status presence serializes concurrent owned settings mutations', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const settingsPath = path.join(configDir, 'settings.json');
  const unrelated = { permissions: { allow: ['Read', 'WebSearch'] }, env: { SYNTHETIC: 'kept' } };
  await writeFile(settingsPath, `${JSON.stringify(unrelated)}\n`, 'utf8');
  const enabled = await Promise.all(Array.from({ length: 16 }, () => (
    enableStatusPresence({ host: 'claude', configDir, stateDir })
  )));
  assert.ok(enabled.every((result) => result.status === 'enabled'));
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), {
    ...unrelated,
    statusLine: JSON.parse(await readFile(settingsPath, 'utf8')).statusLine,
  });
  const disabled = await Promise.all(Array.from({ length: 16 }, () => (
    disableStatusPresence({ host: 'claude', configDir, stateDir })
  )));
  assert.ok(disabled.every((result) => result.status === 'available'));
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), unrelated);
});

test('Claude status presence refuses to overwrite settings changed during its write', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const settingsPath = path.join(configDir, 'settings.json');
  await writeFile(settingsPath, `${JSON.stringify({ syntheticPadding: 'x'.repeat(32 * 1024 * 1024) })}\n`, 'utf8');
  let settled = false;
  const enable = enableStatusPresence({ host: 'claude', configDir, stateDir }).finally(() => { settled = true; });
  let temporaryObserved = false;
  while (!settled) {
    temporaryObserved = (await readdir(configDir)).some((name) => /^settings\.json\..+\.tmp$/u.test(name));
    if (temporaryObserved) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(temporaryObserved, true);
  const external = { permissions: { allow: ['Read'] }, changedBy: 'synthetic-external-editor' };
  await writeFile(settingsPath, `${JSON.stringify(external)}\n`, 'utf8');
  await assert.rejects(
    enable,
    (error) => error instanceof StatusPresenceError && error.code === 'claude_settings_changed',
  );
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), external);
  await assert.rejects(lstat(path.join(configDir, 'viventium-feelings', 'statusline.mjs')), { code: 'ENOENT' });
});

test('Claude status presence distinguishes waiting, reacting, degraded, pressure, pause, and corrupt state', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir: stateDir });
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  await enableStatusPresence({ host: 'claude', configDir, stateDir });
  const settings = JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8'));
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · On · waiting\n');
  await store.recordReactionHealth({ status: 'running' });
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · On · reacting\n');
  await store.recordReactionHealth({ status: 'degraded', errorCode: 'provider_auth_missing' });
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · On · needs attention\n');
  await store.recordReactionHealth({ status: 'skipped', skipReason: 'reaction_queue_full' });
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · On · needs attention\n');
  await store.recordReactionHealth({ status: 'skipped', skipReason: 'completion_timeout' });
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · On · needs attention\n');
  const current = await store.read();
  await store.setEnabled({ expectedVersion: current.version, enabled: false });
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · Off · paused\n');
  await writeFile(path.join(stateDir, 'state.json'), '{synthetic-corrupt', 'utf8');
  assert.equal(await runStatusCommand(settings.statusLine.command), 'V Feelings · Not set up\n');
});

test('Claude status presence refuses to overwrite or remove another status line', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const settingsPath = path.join(configDir, 'settings.json');
  const custom = { permissions: { allow: ['Read'] }, statusLine: { type: 'command', command: '~/.claude/custom.sh' } };
  await writeFile(settingsPath, `${JSON.stringify(custom)}\n`, 'utf8');
  assert.equal((await getStatusPresence({ host: 'claude', configDir, stateDir })).status, 'conflict');
  for (const action of [enableStatusPresence, disableStatusPresence]) {
    await assert.rejects(
      action({ host: 'claude', configDir, stateDir }),
      (error) => error instanceof StatusPresenceError && error.code === 'status_line_conflict',
    );
  }
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), custom);
});

test('Claude status presence shell command treats a special-character config path only as data', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const root = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  const configDir = path.join(root, '`touch PWNED`');
  await mkdir(configDir);
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(root, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir: stateDir });
  await store.setEnabled({ expectedVersion: 0, enabled: true });
  await enableStatusPresence({ host: 'claude', configDir, stateDir });
  const settings = JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8'));
  const child = spawn('/bin/sh', ['-c', settings.statusLine.command], { cwd: root });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end('{}');
  });
  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(output).toString('utf8'), 'V Feelings · On · waiting\n');
  await assert.rejects(lstat(path.join(root, 'PWNED')), { code: 'ENOENT' });
});

test('Claude status presence preserves a valid symlinked settings file', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  const dotfilesDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-dotfiles-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
    rm(dotfilesDir, { recursive: true, force: true }),
  ]));
  const target = path.join(dotfilesDir, 'claude-settings.json');
  const settingsPath = path.join(configDir, 'settings.json');
  await writeFile(target, '{"permissions":{"allow":["Read"]}}\n', 'utf8');
  await symlink(target, settingsPath);
  await enableStatusPresence({ host: 'claude', configDir, stateDir });
  assert.equal((await lstat(settingsPath)).isSymbolicLink(), true);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).statusLine.type, 'command');
  await disableStatusPresence({ host: 'claude', configDir, stateDir });
  assert.equal((await lstat(settingsPath)).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { permissions: { allow: ['Read'] } });
});

test('Claude status presence refuses a dangling settings symlink without replacing it', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const settingsPath = path.join(configDir, 'settings.json');
  await symlink(path.join(configDir, 'missing-dotfiles-settings.json'), settingsPath);
  await assert.rejects(
    enableStatusPresence({ host: 'claude', configDir, stateDir }),
    (error) => error instanceof StatusPresenceError && error.code === 'claude_settings_invalid',
  );
  assert.equal((await lstat(settingsPath)).isSymbolicLink(), true);
});

test('Claude status presence refuses a managed-script symlink without touching its target', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-target-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
    rm(targetDir, { recursive: true, force: true }),
  ]));
  const managedDir = path.join(configDir, 'viventium-feelings');
  const target = path.join(targetDir, 'unrelated.mjs');
  await mkdir(managedDir, { mode: 0o700 });
  await writeFile(target, 'DO NOT TOUCH\n', 'utf8');
  await symlink(target, path.join(managedDir, 'statusline.mjs'));
  await assert.rejects(
    enableStatusPresence({ host: 'claude', configDir, stateDir }),
    (error) => error instanceof StatusPresenceError && error.code === 'claude_status_script_invalid',
  );
  assert.equal(await readFile(target, 'utf8'), 'DO NOT TOUCH\n');
  assert.equal((await lstat(path.join(managedDir, 'statusline.mjs'))).isSymbolicLink(), true);
});

test('Claude Remove V refuses an unowned managed-path file without changing settings', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  await enableStatusPresence({ host: 'claude', configDir, stateDir });
  const settingsPath = path.join(configDir, 'settings.json');
  const scriptPath = path.join(configDir, 'viventium-feelings', 'statusline.mjs');
  const enabledSettings = await readFile(settingsPath, 'utf8');
  await writeFile(scriptPath, 'FOREIGN CONTENT\n', 'utf8');

  await assert.rejects(
    disableStatusPresence({ host: 'claude', configDir, stateDir }),
    (error) => error instanceof StatusPresenceError && error.code === 'claude_status_script_unowned',
  );
  assert.equal(await readFile(scriptPath, 'utf8'), 'FOREIGN CONTENT\n');
  assert.equal(await readFile(settingsPath, 'utf8'), enabledSettings);
});

test('Claude status presence refuses a symlinked managed directory', async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-state-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-config-'));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-status-target-'));
  t.after(() => Promise.all([
    rm(stateDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
    rm(targetDir, { recursive: true, force: true }),
  ]));
  await symlink(targetDir, path.join(configDir, 'viventium-feelings'));
  await assert.rejects(
    enableStatusPresence({ host: 'claude', configDir, stateDir }),
    (error) => error instanceof StatusPresenceError && error.code === 'claude_status_directory_invalid',
  );
  assert.deepEqual(await readdir(targetDir), []);
});

test('Codex reports native plugin branding and rejects Claude-only status mutation', async () => {
  const presence = await getStatusPresence({ host: 'codex', stateDir: '/synthetic' });
  assert.equal(presence.status, 'native_branding');
  await assert.rejects(
    enableStatusPresence({ host: 'codex', stateDir: '/synthetic' }),
    (error) => error instanceof StatusPresenceError && error.code === 'status_presence_unsupported',
  );
});
