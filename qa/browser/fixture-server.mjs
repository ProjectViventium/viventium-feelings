#!/usr/bin/env node

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startDashboardServer } from '../../plugins/viventium-feelings/runtime/dashboard-server.mjs';
import { createStateStore } from '../../plugins/viventium-feelings/runtime/state-store.mjs';

const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-feelings-browser-qa-'));
const store = createStateStore({ dir });
let state = await store.setEnabled({ expectedVersion: 0, enabled: true });
state = await store.applyProfile({ expectedVersion: state.version, profileId: 'grounded', resetCurrent: true });
state = (await store.commitReaction({
  eventId: 'stimulus-aaaaaaaaaaaaaaaaaaaaaaaa',
  baseVersion: state.version,
  baseControlEpoch: state.controlEpoch,
  changes: [
    { band: 'curiosity', direction: 'up', strength: 'strong', cause: 'new_information' },
    { band: 'drive', direction: 'up', strength: 'clear', cause: 'progress' },
    { band: 'vigilance', direction: 'down', strength: 'slight', cause: 'care_signal' },
  ],
  innerState: 'I feel the shape of this opening up, and I want to follow it all the way through.',
  health: { requestedHost: 'codex', usedHost: 'codex', usedModel: 'synthetic-qa', durationMs: 840, fallbackUsed: false },
})).state;
state = (await store.commitReaction({
  eventId: 'stimulus-bbbbbbbbbbbbbbbbbbbbbbbb',
  baseVersion: state.version,
  baseControlEpoch: state.controlEpoch,
  changes: [
    { band: 'connection', direction: 'up', strength: 'clear', cause: 'connection_bid' },
    { band: 'play', direction: 'up', strength: 'slight', cause: 'playful_exchange' },
  ],
  innerState: 'I feel closer to the work now, with a light urge to make the next move memorable.',
  health: { requestedHost: 'codex', usedHost: 'codex', usedModel: 'synthetic-qa', durationMs: 790, fallbackUsed: false },
})).state;

const dashboard = await startDashboardServer({ store, host: 'codex', port: 0, idleTimeoutMs: 0 });
process.stdout.write(`${JSON.stringify({ url: dashboard.url, origin: dashboard.origin, stateDir: dir })}\n`);

async function close() {
  await dashboard.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
