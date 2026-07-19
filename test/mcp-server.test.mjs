import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
