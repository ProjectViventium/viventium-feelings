#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { startDashboardServer } from './dashboard-server.mjs';
import { createStateStore, resolveHost } from './state-store.mjs';

const tool = (name, description, properties = {}, required = [], annotations = {}) => ({
  name,
  description,
  inputSchema: { type: 'object', additionalProperties: false, properties, required },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    ...annotations,
  },
});

const version = { type: 'integer', minimum: 0, description: 'Current state version from feelings_get_state.' };
const TOOLS = Object.freeze([
  tool('feelings_get_state', 'Read the current local Viventium feeling state.', {}, [], { readOnlyHint: true }),
  tool('feelings_set_enabled', 'Explicitly enable or pause Feelings.', {
    expectedVersion: version, enabled: { type: 'boolean' },
  }, ['expectedVersion', 'enabled']),
  tool('feelings_apply_profile', 'Apply a transparent Nature profile and reset Current to it.', {
    expectedVersion: version,
    profileId: { type: 'string', enum: ['grounded', 'candid', 'warm', 'curious'] },
  }, ['expectedVersion', 'profileId']),
  tool('feelings_reset', 'Reset Current feelings to Nature.', { expectedVersion: version }, ['expectedVersion'], { destructiveHint: true }),
  tool('feelings_erase', 'Permanently erase all local Feelings state, trail, gates, audit, and key.', {
    expectedVersion: version,
  }, ['expectedVersion'], { destructiveHint: true }),
  tool('feelings_open_dashboard', 'Open the private live Feelings dashboard in the local browser.', {}, []),
]);

function assertOnlyKeys(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments_invalid');
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error('arguments_invalid');
}

function summary(state) {
  return {
    version: state.version,
    enabled: state.enabled,
    profile: state.profiles[state.profileId]?.name ?? 'Custom',
    innerState: state.innerState?.text ?? null,
    health: state.reactionHealth.status,
    feelings: Object.fromEntries(Object.entries(state.bands).map(([id, band]) => [id, {
      current: Math.round(band.current * 10) / 10,
      nature: band.baseline,
    }])),
  };
}

function success(value, message) {
  return {
    isError: false,
    content: [{ type: 'text', text: message ?? JSON.stringify(value) }],
    structuredContent: value,
  };
}

function failure(error) {
  return { isError: true, content: [{ type: 'text', text: `Feelings could not complete that action (${error?.code ?? 'error'}).` }] };
}

export function createMcpService({ store = createStateStore(), openBrowser } = {}) {
  let dashboard;
  const opener = openBrowser ?? (async (url) => {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  });

  async function callTool(name, args = {}) {
    if (name === 'feelings_get_state') {
      assertOnlyKeys(args, []);
      const state = await store.read();
      return success(summary(state), state.enabled ? 'Feelings are enabled.' : 'Feelings are off.');
    }
    if (name === 'feelings_set_enabled') {
      assertOnlyKeys(args, ['expectedVersion', 'enabled']);
      const state = await store.setEnabled(args);
      return success(summary(state), state.enabled ? 'Feelings enabled.' : 'Feelings paused.');
    }
    if (name === 'feelings_apply_profile') {
      assertOnlyKeys(args, ['expectedVersion', 'profileId']);
      const state = await store.applyProfile({ ...args, resetCurrent: true });
      return success(summary(state), `${state.profiles[args.profileId].name} Nature applied.`);
    }
    if (name === 'feelings_reset') {
      assertOnlyKeys(args, ['expectedVersion']);
      return success(summary(await store.reset(args)), 'Current feelings reset to Nature.');
    }
    if (name === 'feelings_erase') {
      assertOnlyKeys(args, ['expectedVersion']);
      return success(await store.erase(args), 'All local Feelings data erased.');
    }
    if (name === 'feelings_open_dashboard') {
      assertOnlyKeys(args, []);
      if (!dashboard || dashboard.isClosed()) dashboard = await startDashboardServer({ store, host: resolveHost() });
      await opener(dashboard.url);
      return success({ opened: true }, 'The private Feelings dashboard is open.');
    }
    throw new Error('tool_unknown');
  }

  return {
    async handle(message) {
      if (message.method === 'initialize') return {
        jsonrpc: '2.0', id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'viventium-feelings', version: '0.1.1' },
        },
      };
      if (message.method === 'notifications/initialized') return null;
      if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
      if (message.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } };
      if (message.method === 'tools/call') {
        try {
          return {
            jsonrpc: '2.0', id: message.id,
            result: await callTool(message.params?.name, message.params?.arguments ?? {}),
          };
        } catch (error) {
          return { jsonrpc: '2.0', id: message.id, result: failure(error) };
        }
      }
      return { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: 'Method not found' } };
    },
    async close() {
      await dashboard?.close();
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.env.VIVENTIUM_FEELINGS_REACTION_CHILD === '1') process.exit(0);
  const service = createMcpService();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', async (line) => {
    let response;
    try {
      response = await service.handle(JSON.parse(line));
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  process.on('SIGTERM', async () => { await service.close(); process.exit(0); });
}
