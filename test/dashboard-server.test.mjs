import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

import { startDashboardServer } from '../plugins/viventium-feelings/runtime/dashboard-server.mjs';
import { createStateStore } from '../plugins/viventium-feelings/runtime/state-store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-dashboard-test-'));
  const store = createStateStore({ dir, now: () => new Date('2026-07-18T12:00:00.000Z') });
  const dashboard = await startDashboardServer({ store, host: 'codex', port: 0, idleTimeoutMs: 0 });
  t.after(async () => {
    await dashboard.close();
    await rm(dir, { recursive: true, force: true });
  });
  const headers = { authorization: `Bearer ${dashboard.token}`, origin: dashboard.origin };
  return { dir, store, dashboard, headers };
}

test('serves a no-external-resource dashboard with strict browser headers', async (t) => {
  const { dashboard } = await fixture(t);
  assert.match(dashboard.url, /^http:\/\/127\.0\.0\.1:\d+\/#/u);
  const response = await fetch(`${dashboard.origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/u);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(await response.text(), /Viventium Feelings/u);
});

test('API requires the launch bearer or session and exact same origin for mutations', async (t) => {
  const { dashboard, headers } = await fixture(t);
  assert.equal((await fetch(`${dashboard.origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${dashboard.origin}/api/state`, {
    headers: { ...headers, origin: 'https://example.com' },
  })).status, 403);
  const response = await fetch(`${dashboard.origin}/api/state`, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.enabled, false);
});

test('Host, request-body, and 4,000-character setting boundaries fail closed', async (t) => {
  const { dashboard, headers } = await fixture(t);
  const badHost = await new Promise((resolve, reject) => {
    const target = new URL(dashboard.origin);
    const request = http.get({
      hostname: target.hostname,
      port: target.port,
      path: '/api/state',
      headers: { authorization: headers.authorization, host: 'evil.example' },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
  });
  assert.equal(badHost.status, 421);
  assert.equal(badHost.json().error.code, 'host_invalid');

  let response = await fetch(`${dashboard.origin}/api/settings`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, patch: { reactionInstruction: 'x'.repeat(4000) } }),
  });
  assert.equal(response.status, 200);
  const state = (await response.json()).state;

  response = await fetch(`${dashboard.origin}/api/settings`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: state.version, patch: { reactionInstruction: 'x'.repeat(4001) } }),
  });
  assert.equal(response.status, 422);

  response = await fetch(`${dashboard.origin}/api/settings`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: state.version, patch: { reactionInstruction: 'x'.repeat(70_000) } }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'body_too_large');
});

test('dashboard mutations reject coercion and malformed nested range schemas with 422', async (t) => {
  const { dashboard, headers, store } = await fixture(t);
  const request = (route, body) => fetch(`${dashboard.origin}${route}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const patchBand = (patch) => fetch(`${dashboard.origin}/api/bands/mood`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, patch }),
  });
  for (const patch of [
    { current: '91' },
    { current: null },
    { baseline: '58' },
    { halfLifeMinutes: '360' },
    { reset: 'true' },
    { rangePromptOverrides: { level_0: { nested: 'invalid' } } },
  ]) {
    const response = await patchBand(patch);
    assert.equal(response.status, 422);
  }
  const profile = await request('/api/profile', {
    expectedVersion: 0,
    profileId: 'warm',
    resetCurrent: 'false',
  });
  assert.equal(profile.status, 422);
  assert.equal(await store.exists(), false);
});

test('one-time bearer bootstrap issues an HttpOnly same-site refresh session', async (t) => {
  const { dashboard } = await fixture(t);
  const response = await fetch(`${dashboard.origin}/api/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dashboard.token}`, origin: dashboard.origin },
  });
  assert.equal(response.status, 204);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(cookie, /Path=\//u);
  assert.doesNotMatch(cookie, /Max-Age/u);
});

test('idle close is observable so callers can replace a stale dashboard URL', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-dashboard-test-'));
  const store = createStateStore({ dir });
  const dashboard = await startDashboardServer({ store, idleTimeoutMs: 20 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal(dashboard.isClosed(), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(dashboard.isClosed(), true);
  await dashboard.close();
});

test('versioned controls enable, tune, apply profile, reset, and erase', async (t) => {
  const { dashboard, headers, store } = await fixture(t);
  const request = (route, method, body) => fetch(`${dashboard.origin}${route}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let response = await request('/api/enabled', 'PATCH', { expectedVersion: 0, enabled: true });
  assert.equal(response.status, 200);
  let state = (await response.json()).state;
  assert.equal(state.enabled, true);

  response = await request('/api/bands/mood', 'PATCH', {
    expectedVersion: state.version,
    patch: { current: 91 },
  });
  state = (await response.json()).state;
  assert.equal(state.bands.mood.current, 91);

  const conflict = await request('/api/reset', 'POST', { expectedVersion: 0 });
  assert.equal(conflict.status, 409);

  response = await request('/api/profile', 'POST', {
    expectedVersion: state.version,
    profileId: 'warm',
    resetCurrent: true,
  });
  state = (await response.json()).state;
  assert.equal(state.profileId, 'warm');
  assert.equal(state.bands.care.current, 86);

  response = await request('/api/reset', 'POST', { expectedVersion: state.version });
  state = (await response.json()).state;
  assert.equal(state.bands.care.current, state.bands.care.baseline);

  response = await request('/api/state', 'DELETE', { expectedVersion: state.version });
  assert.equal(response.status, 200);
  assert.equal(await store.exists(), false);
});

test('dashboard renderer never injects state via innerHTML', async () => {
  const dashboard = await readFile(
    path.resolve(import.meta.dirname, '../plugins/viventium-feelings/dashboard/dashboard.js'),
    'utf8',
  );
  const render = await readFile(
    path.resolve(import.meta.dirname, '../plugins/viventium-feelings/dashboard/render.js'),
    'utf8',
  );
  assert.doesNotMatch(`${dashboard}\n${render}`, /\.innerHTML\s*=/u);
  assert.match(render, /textContent/u);
  const api = await readFile(
    path.resolve(import.meta.dirname, '../plugins/viventium-feelings/dashboard/api.js'),
    'utf8',
  );
  assert.match(api, /history\.replaceState[\s\S]*token = ''/u);
});
