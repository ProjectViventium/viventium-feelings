#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startDashboardServer } from '../../plugins/viventium-feelings/runtime/dashboard-server.mjs';
import { createStateStore } from '../../plugins/viventium-feelings/runtime/state-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PWCLI = process.env.PWCLI || path.join(os.homedir(), '.codex', 'skills', 'playwright', 'scripts', 'playwright_cli.sh');
const session = `viventium-dashboard-${process.pid}`;

function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PWCLI, [`-s=${session}`, ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${Buffer.concat(stdout).toString('utf8')}\n${Buffer.concat(stderr).toString('utf8')}`;
      if (code !== 0) return reject(new Error(`playwright_cli_failed:${args[0]}:${output.slice(0, 800)}`));
      resolve(output);
    });
  });
}

const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-dashboard-browser-'));
let clock = new Date('2026-07-18T12:00:00.000Z');
const store = createStateStore({ dir, now: () => new Date(clock) });
const dashboard = await startDashboardServer({ store, host: 'codex', idleTimeoutMs: 0 });

try {
  await mkdir(path.join(ROOT, 'qa', 'artifacts'), { recursive: true });
  await cli('open', dashboard.url);
  let snapshot = await cli('snapshot');
  if (!/Before you turn it on|Your feelings stay local/u.test(snapshot)
      || !/may use your existing plan quota/u.test(snapshot)) {
    throw new Error('onboarding_disclosure_missing');
  }
  if (await store.exists()) throw new Error('disclosure_read_created_state');
  await cli('click', 'button:has-text("I understand")');
  await cli('click', '#powerToggle');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(300); }');
  let state = await store.read();
  if (!state.enabled) throw new Error('first_enable_failed');
  state = (await store.commitReaction({
    eventId: 'stimulus-cccccccccccccccccccccccc',
    baseVersion: state.version,
    baseControlEpoch: state.controlEpoch,
    changes: [{ band: 'curiosity', direction: 'up', strength: 'clear', cause: 'new_information' }],
    innerState: 'I want to follow this opening one step further.',
    health: { requestedHost: 'codex', usedHost: 'codex', usedModel: 'synthetic-qa', durationMs: 500 },
  })).state;
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Viventium Feelings|Live emotional state/u.test(snapshot) || !/Curiosity: Current 74/u.test(snapshot)) {
    throw new Error('dashboard_content_missing');
  }
  await store.recordReactionHealth({
    status: 'degraded', errorCode: 'provider_auth_missing', requestedHost: 'codex',
  });
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Reaction needs provider sign-in/u.test(snapshot)) throw new Error('health_auth_guidance_missing');
  await store.recordReactionHealth({
    status: 'degraded', errorCode: 'provider_rate_limit', requestedHost: 'codex',
  });
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Reaction paused by provider usage limit/u.test(snapshot)) {
    throw new Error('same_status_health_guidance_stale');
  }
  await store.recordReactionHealth({ status: 'healthy', requestedHost: 'codex' });
  clock = new Date('2026-07-18T12:45:00.000Z');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Curiosity: Current 70/u.test(snapshot)) throw new Error('live_decay_not_rendered_without_version_change');
  await cli('run-code', `async (page) => {
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    if (!await page.locator('.brand').evaluate((node) => node === document.activeElement)) throw new Error('keyboard_order_brand');
    await page.keyboard.press('Tab');
    if (!await page.locator('#powerToggle').evaluate((node) => node === document.activeElement)) throw new Error('keyboard_order_power');
    await page.locator('button[data-band="mood"]').focus();
    await page.keyboard.press('Enter');
    if (!await page.locator('#bandDialog').evaluate((node) => node.open)) throw new Error('keyboard_dialog_open');
    await page.keyboard.press('Escape');
  }`);
  await cli('resize', '320', '800');
  let dimensions = await cli('eval', '() => ({innerWidth, scrollWidth: document.documentElement.scrollWidth})');
  if (!/"innerWidth": 320/u.test(dimensions) || !/"scrollWidth": 320/u.test(dimensions)) throw new Error('mobile_overflow');
  for (const [width, height] of [[768, 900], [1024, 900], [1440, 1000]]) {
    await cli('resize', String(width), String(height));
    await cli('run-code', `async (page) => {
      const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      if (dimensions.innerWidth !== ${width} || dimensions.scrollWidth !== ${width}) throw new Error('viewport_overflow_${width}');
    }`);
  }
  await cli('run-code', `async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page.locator('.band-row').first().evaluate((node) => getComputedStyle(node).animationDuration);
    if (Number.parseFloat(duration) > 0.01) throw new Error('reduced_motion_not_collapsed');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }`);
  await cli('click', 'button[data-band="mood"]');
  await cli('click', '#bandDialog summary');
  snapshot = await cli('snapshot');
  if (!/Range embodiment/u.test(snapshot) || !/0–19 · deeply sad/u.test(snapshot)) {
    throw new Error('range_editor_missing');
  }
  await cli('fill', 'textarea[data-level-id="level_0"]', 'Let the heaviness narrow what feels possible.');
  await cli('click', '#saveBand');
  await cli('reload');
  await cli('click', 'button[data-band="mood"]');
  await cli('click', '#bandDialog summary');
  snapshot = await cli('snapshot');
  if (!/Let the heaviness narrow what feels possible\./u.test(snapshot)) throw new Error('range_editor_not_persisted');
  await cli('press', 'Escape');
  await cli('fill', '#reactionInstruction', 'React only when the synthetic moment meaningfully changes a feeling.');
  await cli('click', '#saveInstruction');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(300); }');
  await cli('reload');
  await cli('run-code', `async (page) => {
    const value = await page.locator('#reactionInstruction').inputValue();
    if (value !== 'React only when the synthetic moment meaningfully changes a feeling.') throw new Error('instruction_not_persisted');
  }`);
  await cli('click', 'button.profile-option:has-text("Warm")');
  snapshot = await cli('snapshot');
  if (!/Apply Warm Nature\?/u.test(snapshot)) throw new Error('profile_confirmation_missing');
  await cli('click', 'button:has-text("Apply Warm")');
  snapshot = await cli('snapshot');
  if (!/Care: Current 86, Nature 86/u.test(snapshot)) throw new Error('profile_not_applied');
  await cli('click', '#powerToggle');
  await cli('reload');
  snapshot = await cli('snapshot');
  if (/switch "Enable Feelings" \[checked\]/u.test(snapshot)) throw new Error('pause_not_persisted');
  const consoleOutput = await cli('console', 'warning');
  if (!/Total messages: 0/u.test(consoleOutput)) throw new Error('console_not_clean');
  const requests = await cli('requests');
  if (/https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|\s|$))/u.test(requests)) throw new Error('external_request_detected');
  await cli('network-state-set', 'offline');
  await cli('click', '#powerToggle');
  await cli('run-code', `async (page) => {
    await page.waitForTimeout(300);
    if (await page.locator('#powerToggle').isChecked()) throw new Error('failed_mutation_toggle_not_rolled_back');
    if (await page.locator('#powerLabel').textContent() !== 'Off') throw new Error('failed_mutation_label_not_rolled_back');
  }`);
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Connection interrupted/u.test(snapshot)) throw new Error('network_interruption_not_visible');
  await cli('network-state-set', 'online');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(2300); }');
  snapshot = await cli('snapshot');
  if (!/Live · updated/u.test(snapshot)) throw new Error('network_recovery_not_visible');
  await cli('click', '#powerToggle');
  await cli('reload');
  snapshot = await cli('snapshot');
  if (!/switch "Enable Feelings" \[checked\]/u.test(snapshot)) throw new Error('resume_not_persisted');
  await cli('click', '#resetButton');
  snapshot = await cli('snapshot');
  if (!/Reset Current to Nature\?/u.test(snapshot)) throw new Error('reset_confirmation_missing');
  await cli('click', '#confirmAction');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(300); }');
  await cli('screenshot', '--filename', 'qa/artifacts/dashboard-browser-qa.png', '--hires');
  await cli('click', '#eraseButton');
  snapshot = await cli('snapshot');
  if (!/Erase all local Feelings data\?/u.test(snapshot)) throw new Error('erase_confirmation_missing');
  await cli('click', '#confirmAction');
  await cli('run-code', 'async (page) => { await page.waitForTimeout(300); }');
  snapshot = await cli('snapshot');
  if (!/Before you turn it on|Your feelings stay local/u.test(snapshot)) {
    throw new Error('erase_did_not_restore_onboarding_disclosure');
  }
  const erased = await store.read();
  if (erased.enabled || erased.version !== 0 || erased.trail.length !== 0) throw new Error('erase_state_not_default_off');
  for (const file of ['state.json', 'audit.jsonl', '.event-key']) {
    let exists = true;
    await access(path.join(dir, file)).catch(() => { exists = false; });
    if (exists) throw new Error(`erase_left_${file}`);
  }
  process.stdout.write('PASS: real Chromium onboarding/default-off, live decay, 320–1440, keyboard/reduced-motion, range/instruction persistence, profile, pause/resume, interruption recovery, reset/erase, local-only network, clean normal-operation console, and screenshot.\n');
} finally {
  await cli('close').catch(() => {});
  await dashboard.close();
  await rm(dir, { recursive: true, force: true });
}
