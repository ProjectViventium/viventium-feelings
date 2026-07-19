import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMcpService } from '../plugins/viventium-feelings/runtime/mcp-server.mjs';
import { createStateStore } from '../plugins/viventium-feelings/runtime/state-store.mjs';

test('MCP exposes explicit local state controls and no generic execution tool', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createMcpService({ store: createStateStore({ dir }), openBrowser: async () => {} });
  const listed = await service.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'feelings_get_state',
    'feelings_set_enabled',
    'feelings_apply_profile',
    'feelings_reset',
    'feelings_erase',
    'feelings_open_dashboard',
    'feelings_get_status_presence',
    'feelings_set_status_presence',
  ]);
  assert.ok(listed.result.tools.every((tool) => tool.inputSchema.additionalProperties === false));
  assert.ok(!names.some((name) => /exec|shell|write_file/u.test(name)));
  assert.equal(
    listed.result.tools.find((entry) => entry.name === 'feelings_set_status_presence').annotations.destructiveHint,
    true,
  );
  assert.equal(
    listed.result.tools.find((entry) => entry.name === 'feelings_reset').annotations.destructiveHint,
    true,
  );
  assert.equal(
    listed.result.tools.find((entry) => entry.name === 'feelings_erase').annotations.destructiveHint,
    true,
  );
  await service.close();
});

test('MCP status presence is explicit, host-aware, and reversible', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-config-'));
  t.after(() => Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir });
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'claude', configDir });
  let response = await service.handle({
    jsonrpc: '2.0', id: 20, method: 'tools/call',
    params: { name: 'feelings_get_status_presence', arguments: {} },
  });
  assert.equal(response.result.structuredContent.status, 'available');
  response = await service.handle({
    jsonrpc: '2.0', id: 21, method: 'tools/call',
    params: { name: 'feelings_set_status_presence', arguments: { action: 'enable' } },
  });
  assert.equal(response.result.structuredContent.status, 'enabled');
  response = await service.handle({
    jsonrpc: '2.0', id: 22, method: 'tools/call',
    params: { name: 'feelings_set_status_presence', arguments: { action: 'disable' } },
  });
  assert.equal(response.result.structuredContent.status, 'available');

  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await service.handle({
    jsonrpc: '2.0', id: 23, method: 'tools/call',
    params: { name: 'feelings_set_status_presence', arguments: { action: 'enable' } },
  });
  response = await service.handle({
    jsonrpc: '2.0', id: 24, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.erased, true);
  assert.equal(response.result.structuredContent.statusPresence.status, 'available');
  assert.equal(response.result.content[0].text, 'Feelings data and Viventium-owned Claude status presence erased.');
  assert.equal(await store.exists(), false);
  await service.close();
});

test('MCP erase removes an orphaned owned Claude renderer after its setting disappears', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-config-'));
  t.after(() => Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir });
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'claude', configDir });
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await service.handle({
    jsonrpc: '2.0', id: 27, method: 'tools/call',
    params: { name: 'feelings_set_status_presence', arguments: { action: 'enable' } },
  });
  const scriptPath = path.join(configDir, 'viventium-feelings', 'statusline.mjs');
  await writeFile(path.join(configDir, 'settings.json'), '{}\n', 'utf8');
  const response = await service.handle({
    jsonrpc: '2.0', id: 28, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.ownedPresenceRemoved, true);
  assert.equal(response.result.content[0].text, 'Feelings data and Viventium-owned Claude status presence erased.');
  await assert.rejects(lstat(scriptPath), { code: 'ENOENT' });
  assert.equal(await store.exists(), false);
  await service.close();
});

test('MCP erase removes orphaned owned residue while preserving a replacement Claude status line', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-config-'));
  t.after(() => Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir });
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'claude', configDir });
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  await service.handle({
    jsonrpc: '2.0', id: 29, method: 'tools/call',
    params: { name: 'feelings_set_status_presence', arguments: { action: 'enable' } },
  });
  const custom = { statusLine: { type: 'command', command: '~/.claude/custom.sh' } };
  await writeFile(path.join(configDir, 'settings.json'), `${JSON.stringify(custom)}\n`, 'utf8');
  const scriptPath = path.join(configDir, 'viventium-feelings', 'statusline.mjs');
  const response = await service.handle({
    jsonrpc: '2.0', id: 30, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.statusPresence.status, 'conflict');
  assert.equal(response.result.structuredContent.ownedPresenceRemoved, true);
  assert.equal(
    response.result.content[0].text,
    'Feelings data and orphaned Viventium status residue erased. Your custom Claude status line was left unchanged.',
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(configDir, 'settings.json'), 'utf8')), custom);
  await assert.rejects(lstat(scriptPath), { code: 'ENOENT' });
  await service.close();
});

test('MCP erase reports that a foreign Claude status line was preserved', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-config-'));
  t.after(() => Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const settingsPath = path.join(configDir, 'settings.json');
  const custom = { statusLine: { type: 'command', command: '~/.claude/custom.sh' } };
  await writeFile(settingsPath, `${JSON.stringify(custom)}\n`, 'utf8');
  const store = createStateStore({ dir });
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'claude', configDir });
  const response = await service.handle({
    jsonrpc: '2.0', id: 25, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.statusPresence.status, 'conflict');
  assert.equal(response.result.content[0].text, 'Feelings data erased. Your custom Claude status line was left unchanged.');
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), custom);
  assert.equal(await store.exists(), false);
  await service.close();
});

test('MCP erase describes Codex plugin identity without claiming system cleanup', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createStateStore({ dir });
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'codex' });
  const response = await service.handle({
    jsonrpc: '2.0', id: 26, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.statusPresence.status, 'native_branding');
  assert.equal(response.result.content[0].text, 'Feelings data erased. Codex plugin identity remains until the plugin is removed.');
  await service.close();
});

test('MCP erase preserves an unowned file at the managed Claude renderer path', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-config-'));
  t.after(() => Promise.all([
    rm(dir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
  ]));
  const store = createStateStore({ dir });
  const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
  const managedDir = path.join(configDir, 'viventium-feelings');
  const scriptPath = path.join(managedDir, 'statusline.mjs');
  await mkdir(managedDir, { mode: 0o700 });
  await writeFile(scriptPath, 'UNOWNED — DO NOT TOUCH\n', 'utf8');
  const service = createMcpService({ store, openBrowser: async () => {}, host: 'claude', configDir });
  const response = await service.handle({
    jsonrpc: '2.0', id: 31, method: 'tools/call',
    params: { name: 'feelings_erase', arguments: { expectedVersion: enabled.version } },
  });
  assert.equal(response.result.structuredContent.statusPresence.status, 'cleanup_failed');
  assert.equal(response.result.structuredContent.statusPresence.error, 'claude_status_script_unowned');
  assert.equal(response.result.content[0].text, 'Feelings data erased. Owned host presence still needs manual removal.');
  assert.equal(await readFile(scriptPath, 'utf8'), 'UNOWNED — DO NOT TOUCH\n');
  assert.equal(await store.exists(), false);
  await service.close();
});

test('MCP tools preserve version checks and return concise user-facing state', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = createMcpService({ store: createStateStore({ dir }), openBrowser: async () => {} });
  let response = await service.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'feelings_set_enabled', arguments: { expectedVersion: 0, enabled: true } },
  });
  assert.equal(response.result.isError, false);
  assert.match(response.result.content[0].text, /enabled/u);
  response = await service.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'feelings_apply_profile', arguments: { expectedVersion: 1, profileId: 'candid' } },
  });
  assert.match(response.result.content[0].text, /Candid/u);
  await service.close();
});

test('dashboard launch token is used by the opener but never returned to the model transcript', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let openedUrl;
  const service = createMcpService({
    store: createStateStore({ dir }),
    openBrowser: async (url) => { openedUrl = url; },
  });
  const response = await service.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'feelings_open_dashboard', arguments: {} },
  });
  assert.match(openedUrl, /#[A-Za-z0-9_-]+$/u);
  assert.deepEqual(response.result.structuredContent, { opened: true });
  assert.doesNotMatch(JSON.stringify(response), /http:\/\/|#[A-Za-z0-9_-]{20,}/u);
  await service.close();
});
