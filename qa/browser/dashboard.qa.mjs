#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  if (!/Viventium Feelings|Live emotional state/u.test(snapshot)) throw new Error('dashboard_content_missing');
  await cli('run-code', `async (page) => {
    const image = page.locator('.brand-mark img');
    if (await image.getAttribute('src') !== '/viventium-v.png') throw new Error('official_v_mark_missing');
    if (await image.evaluate((node) => node.naturalWidth) !== 96) throw new Error('official_v_mark_not_loaded');
    if (await page.locator('#bands').getAttribute('aria-live') !== null) throw new Error('polling_instrument_is_live_region');
    if (await page.locator('button.profile-option[role]').count() !== 0) throw new Error('profile_button_semantics_overridden');
    for (const band of await page.locator('.band').all()) {
      if (await band.locator('[data-value="current"]').count() !== 1) throw new Error('visible_now_value_missing');
      if (await band.locator('[data-value="nature"]').count() !== 1) throw new Error('visible_nature_value_missing');
      if (await band.locator('.current-reading small').textContent() !== 'Now') throw new Error('now_label_replaced_by_level_word');
    }
  }`);
  const iconBytes = Buffer.from(await (await fetch(`${dashboard.origin}/viventium-v.png`)).arrayBuffer());
  if (createHash('sha256').update(iconBytes).digest('hex') !== '42c7d23aa7355d1e16928fed6181a94e086b259ffa0637fc77724523378c1ac8') {
    throw new Error('website_v_asset_identity_mismatch');
  }

  // System mode follows the OS. Explicit choice is host-profile data, so it
  // survives a second dashboard server on a different random port.
  await cli('run-code', `async (page) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    if (await page.locator('html').getAttribute('data-theme') !== null) throw new Error('system_theme_has_override');
    if (await page.locator('body').evaluate((node) => getComputedStyle(node).backgroundColor) !== 'rgb(14, 14, 16)') {
      throw new Error('system_dark_not_applied');
    }
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(150);
    if (await page.locator('html').getAttribute('data-theme') !== 'light') throw new Error('light_override_not_applied');
  }`);
  const relaunched = await startDashboardServer({ store, host: 'codex', idleTimeoutMs: 0 });
  try {
    await cli('run-code', `async (page) => {
      await page.goto(${JSON.stringify(relaunched.url)});
      await page.waitForTimeout(250);
      if (await page.locator('html').getAttribute('data-theme') !== 'light') throw new Error('theme_not_persisted_across_random_port');
      if (await page.locator('#themeColor').getAttribute('content') !== '#f7f7f5') throw new Error('light_theme_color_stale');
      await page.locator('#themeToggle').click();
      await page.waitForTimeout(150);
      await page.locator('#themeToggle').click();
      await page.waitForTimeout(150);
      await page.emulateMedia({ colorScheme: 'light' });
      if (await page.locator('html').getAttribute('data-theme') !== null) throw new Error('system_theme_not_restored');
    }`);
  } finally {
    await relaunched.close();
  }
  await cli('run-code', `async (page) => { await page.goto(${JSON.stringify(dashboard.url)}); await page.waitForTimeout(250); }`);

  // The Claude-specific status presence is an explicit one-click action and
  // the same control removes only the managed setting.
  const priorClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
  const claudeConfigDir = path.join(dir, 'synthetic-claude-config');
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  const claudeDashboard = await startDashboardServer({ store, host: 'claude', idleTimeoutMs: 0 });
  try {
    await cli('run-code', `async (page) => {
      await page.goto(${JSON.stringify(claudeDashboard.url)});
      await page.locator('a[href="#settings"]').click();
      const presence = page.locator('#hostPresenceButton');
      await page.waitForFunction(() => document.querySelector('#hostPresenceLabel')?.textContent === 'Add V');
      await presence.click();
      await page.waitForFunction(() => document.querySelector('#hostPresenceLabel')?.textContent === 'Remove');
    }`);
    const claudeSettings = JSON.parse(await readFile(path.join(claudeConfigDir, 'settings.json'), 'utf8'));
    if (!/^node --input-type=module -e /u.test(claudeSettings.statusLine?.command ?? '')) {
      throw new Error('claude_status_presence_not_installed');
    }
    await access(path.join(claudeConfigDir, 'viventium-feelings', 'statusline.mjs'));
    await cli('run-code', `async (page) => {
      await page.locator('#hostPresenceButton').click();
      await page.waitForFunction(() => document.querySelector('#hostPresenceLabel')?.textContent === 'Add V');
    }`);
    if (Object.hasOwn(JSON.parse(await readFile(path.join(claudeConfigDir, 'settings.json'), 'utf8')), 'statusLine')) {
      throw new Error('claude_status_presence_not_removed');
    }
  } finally {
    await claudeDashboard.close();
    if (priorClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorClaudeConfig;
  }
  await cli('run-code', `async (page) => { await page.goto(${JSON.stringify(dashboard.url)}); await page.waitForTimeout(250); }`);
  await cli('run-code', `async (page) => {
    const reading = (await page.locator('.band[data-band="curiosity"] .band-reading b').textContent()).trim();
    if (reading !== '74') throw new Error('curiosity_reaction_value:' + reading);
  }`);
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
  await cli('run-code', `async (page) => {
    const reading = (await page.locator('.band[data-band="curiosity"] .band-reading b').textContent()).trim();
    if (reading !== '70') throw new Error('live_decay_not_rendered_without_version_change:' + reading);
  }`);
  await cli('run-code', `async (page) => {
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    if (!await page.locator('.brand').evaluate((node) => node === document.activeElement)) throw new Error('keyboard_order_brand');
    await page.keyboard.press('Tab');
    if (!await page.locator('#themeToggle').evaluate((node) => node === document.activeElement)) throw new Error('keyboard_order_theme');
    await page.keyboard.press('Tab');
    if (!await page.locator('#powerToggle').evaluate((node) => node === document.activeElement)) throw new Error('keyboard_order_power');
  }`);

  // When both values coincide, pressing the upper half of the visible Now dot
  // must move Current rather than Nature's larger hit halo stealing the event.
  state = await store.read();
  const beforeNowPointerVersion = state.version;
  const beforeNowPointerNature = state.bands.mood.baseline;
  const beforeNowPointerCurrent = Math.round(state.bands.mood.current);
  if (beforeNowPointerCurrent !== beforeNowPointerNature) throw new Error('coincident_pointer_precondition');
  await cli('run-code', `async (page) => {
    const current = page.locator('.band[data-band="mood"] .thumb.current');
    const box = await current.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height * 0.25, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  }`);
  state = await store.read();
  if (state.version !== beforeNowPointerVersion + 1) throw new Error('now_pointer_commit_count');
  if (Math.round(state.bands.mood.current) === beforeNowPointerCurrent) throw new Error('now_pointer_not_committed');
  if (state.bands.mood.baseline !== beforeNowPointerNature) throw new Error('now_pointer_moved_nature');

  // Nature remains an independently operable pointer target after Now moves.
  const beforePointerVersion = state.version;
  const beforePointerNature = state.bands.mood.baseline;
  const beforePointerCurrent = Math.round(state.bands.mood.current);
  await cli('run-code', `async (page) => {
    const nature = page.locator('.band[data-band="mood"] .thumb.nature');
    const box = await nature.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  }`);
  state = await store.read();
  if (state.version !== beforePointerVersion + 1) throw new Error('nature_pointer_commit_count');
  if (state.bands.mood.baseline === beforePointerNature) throw new Error('nature_pointer_not_committed');
  if (Math.round(state.bands.mood.current) !== beforePointerCurrent) throw new Error('nature_pointer_moved_current');

  // One keyboard gesture is exactly one versioned commit, even after blur.
  const beforeKeyboardVersion = state.version;
  const beforeKeyboardCurrent = Math.round(state.bands.mood.current);
  await cli('run-code', `async (page) => {
    const thumb = page.locator('.band[data-band="mood"] .thumb.current');
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    if (Number(await thumb.getAttribute('aria-valuenow')) !== ${beforeKeyboardCurrent + 1}) throw new Error('slider_keyboard_no_live_change');
    if (await page.locator('dialog[open]').count() !== 0) throw new Error('unexpected_modal_open');
    await page.waitForTimeout(450);
  }`);
  state = await store.read();
  if (state.version !== beforeKeyboardVersion + 1) throw new Error('keyboard_commit_not_exactly_once');
  await cli('run-code', `async (page) => { await page.locator('.brand').focus(); await page.waitForTimeout(200); }`);
  if ((await store.read()).version !== state.version) throw new Error('keyboard_blur_committed_twice');

  // A pointer gesture supersedes a still-debounced keyboard gesture on the
  // same thumb. It must yield one commit and leave the store equal to the UI.
  state = await store.read();
  const beforeMixedVersion = state.version;
  await cli('run-code', `async (page) => {
    const thumb = page.locator('.band[data-band="mood"] .thumb.current');
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    const box = await thumb.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  }`);
  state = await store.read();
  if (state.version !== beforeMixedVersion + 1) throw new Error('keyboard_pointer_commit_not_exactly_once');
  await cli('run-code', `async (page) => {
    const visible = Number(await page.locator('.band[data-band="mood"] .thumb.current').getAttribute('aria-valuenow'));
    if (visible !== ${Math.round(state.bands.mood.current)}) throw new Error('keyboard_pointer_store_ui_diverged');
  }`);

  // Leaving keyboard focus on one lane must not freeze a reaction elsewhere.
  await cli('run-code', `async (page) => { await page.locator('.band[data-band="mood"] .thumb.current').focus(); }`);
  state = await store.read();
  const focusedReaction = await store.commitReaction({
    eventId: 'stimulus-dddddddddddddddddddddddd',
    baseVersion: state.version,
    baseControlEpoch: state.controlEpoch,
    changes: [{ band: 'care', direction: 'up', strength: 'slight', cause: 'care_signal' }],
    innerState: 'I feel a quiet lift in care while attention stays on the work.',
    health: { requestedHost: 'codex', usedHost: 'codex', usedModel: 'synthetic-qa', durationMs: 400 },
  });
  await cli('run-code', `async (page) => {
    await page.waitForTimeout(2300);
    if (await page.locator('#stateVersion').textContent() !== 'v${focusedReaction.state.version}') throw new Error('focused_lane_froze_version');
    if (!/quiet lift in care/u.test(await page.locator('#innerState').textContent())) throw new Error('focused_lane_froze_inner_state');
  }`);

  // Traversing several controls inside one lane and then leaving it must release
  // that lane exactly once; otherwise later remote movement stays stale forever.
  await cli('run-code', `async (page) => {
    const band = page.locator('.band[data-band="mood"]');
    await band.locator('.thumb.nature').focus();
    await band.locator('.expand-btn').focus();
    await page.locator('.brand').focus();
  }`);
  state = await store.read();
  const postTraversalReaction = await store.commitReaction({
    eventId: 'stimulus-eeeeeeeeeeeeeeeeeeeeeeee',
    baseVersion: state.version,
    baseControlEpoch: state.controlEpoch,
    changes: [{ band: 'mood', direction: 'up', strength: 'slight', cause: 'progress' }],
    innerState: 'The work leaves a small lift in mood after the keyboard pass.',
    health: { requestedHost: 'codex', usedHost: 'codex', usedModel: 'synthetic-qa', durationMs: 350 },
  });
  await cli('run-code', `async (page) => {
    await page.waitForTimeout(2300);
    const visible = Number(await page.locator('.band[data-band="mood"] [data-value="current"]').textContent());
    const expected = ${Math.round(postTraversalReaction.state.bands.mood.current)};
    if (visible !== expected) throw new Error('intra_lane_focus_traversal_leaked:' + visible + '!=' + expected);
  }`);

  // Polling must not destroy keyboard focus on a profile action.
  await cli('run-code', `async (page) => {
    const profile = page.locator('button.profile-option:has-text("Warm")');
    await profile.focus();
    await page.waitForTimeout(2300);
    if (!await profile.evaluate((node) => node === document.activeElement)) throw new Error('profile_poll_destroyed_focus');
  }`);
  state = await store.read();
  const beforePointerCancelVersion = state.version;
  const beforePointerCancelCurrent = Math.round(state.bands.drive.current);
  await cli('run-code', `async (page) => {
    const track = page.locator('.band[data-band="drive"] .band-track');
    const thumb = track.locator('.thumb.current');
    const original = await thumb.getAttribute('aria-valuenow');
    const box = await thumb.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2, { steps: 3 });
    await track.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    await page.mouse.up();
    if (await thumb.getAttribute('aria-valuenow') !== original) throw new Error('pointercancel_did_not_revert');
  }`);
  state = await store.read();
  if (state.version !== beforePointerCancelVersion) throw new Error('pointercancel_wrote_store');
  if (Math.round(state.bands.drive.current) !== beforePointerCancelCurrent) throw new Error('pointercancel_changed_store');
  await cli('resize', '320', '800');
  let dimensions = await cli('eval', '() => ({innerWidth, scrollWidth: document.documentElement.scrollWidth})');
  if (!/"innerWidth": 320/u.test(dimensions) || !/"scrollWidth": 320/u.test(dimensions)) throw new Error('mobile_overflow');
  await cli('run-code', `async (page) => {
    const badge = page.locator('#hostBadge');
    if (!await badge.isVisible()) throw new Error('mobile_host_identity_hidden');
    if ((await badge.textContent()).trim() !== 'Codex') throw new Error('mobile_host_identity_wrong');
  }`);
  for (const [width, height] of [[768, 900], [1024, 900], [1440, 900]]) {
    await cli('resize', String(width), String(height));
    await cli('run-code', `async (page) => {
      const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      if (dimensions.innerWidth !== ${width} || dimensions.scrollWidth !== ${width}) throw new Error('viewport_overflow_${width}');
      if (${width} === 1440) {
        const lastBand = page.locator('.band').last();
        if ((await lastBand.boundingBox()).y + (await lastBand.boundingBox()).height > ${height}) throw new Error('nine_lanes_not_visible_at_1440x900');
      }
    }`);
  }
  await cli('run-code', `async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page.locator('.band-row').first().evaluate((node) => getComputedStyle(node).animationDuration);
    if (Number.parseFloat(duration) > 0.01) throw new Error('reduced_motion_not_collapsed');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }`);
  await cli('click', '.band[data-band="mood"] .expand-btn');
  snapshot = await cli('snapshot');
  if (!/Range embodiment/u.test(snapshot) || !/0–19 · deeply sad/u.test(snapshot)) {
    throw new Error('range_editor_missing');
  }
  // A drawer field save performs a full state render; the equivalent control
  // must regain focus so keyboard users are not thrown back to the document.
  state = await store.read();
  const nextHalfLife = Math.round(state.bands.mood.halfLifeMinutes) + 1;
  await cli('run-code', `async (page) => {
    const input = page.locator('.band[data-band="mood"] input[data-role="halfLife"]');
    await input.focus();
    await input.evaluate((node, next) => {
      node.value = String(next);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, ${nextHalfLife});
    await page.waitForTimeout(450);
    const restored = page.locator('.band[data-band="mood"] input[data-role="halfLife"]');
    if (!await restored.evaluate((node) => node === document.activeElement)) throw new Error('drawer_commit_destroyed_focus');
    if (Number(await restored.inputValue()) !== ${nextHalfLife}) throw new Error('drawer_commit_value_missing');
  }`);
  await cli('fill', '.band[data-band="mood"] textarea[data-level-id="level_0"]', 'Let the heaviness narrow what feels possible.');
  const beforeFailedLane = await store.read();
  await cli('network-state-set', 'offline');
  await cli('run-code', `async (page) => {
    const thumb = page.locator('.band[data-band="mood"] .thumb.current');
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(550);
    const visible = Number(await page.locator('.band[data-band="mood"] [data-value="current"]').textContent());
    if (visible !== ${Math.round(beforeFailedLane.bands.mood.current)}) throw new Error('failed_lane_edit_not_rolled_back:' + visible);
    await page.locator('.band[data-band="mood"] .range-row').first().getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(400);
    const draft = await page.locator('.band[data-band="mood"] textarea[data-level-id="level_0"]').inputValue();
    if (draft !== 'Let the heaviness narrow what feels possible.') throw new Error('failed_range_save_discarded_draft:' + draft);
  }`);
  if ((await store.read()).version !== beforeFailedLane.version) throw new Error('offline_lane_write_reached_store');
  await cli('network-state-set', 'online');
  await cli('run-code', `async (page) => {
    await page.locator('.band[data-band="mood"] .range-row').first().getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(450);
  }`);
  await cli('reload');
  await cli('click', '.band[data-band="mood"] .expand-btn');
  await cli('run-code', `async (page) => {
    const value = await page.locator('.band[data-band="mood"] textarea[data-level-id="level_0"]').inputValue();
    if (value !== 'Let the heaviness narrow what feels possible.') throw new Error('range_editor_not_persisted:' + value);
  }`);
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
  await cli('run-code', `async (page) => {
    await page.waitForTimeout(300);
    const care = (await page.locator('.band[data-band="care"] .band-reading b').textContent()).trim();
    if (care !== '86') throw new Error('profile_not_applied:care=' + care);
  }`);
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
  process.stdout.write('PASS: real Chromium onboarding/default-off, exact V, visible/direct Now+Nature, equal-value Now/Nature pointer separation, exactly-once keyboard and keyboard-to-pointer commits, focused-lane live polling, intra-lane focus traversal release, profile/persisted-field focus preservation, pointercancel rollback, failed-save rollback/draft retention, cross-port theme persistence, mobile host identity, 320–1440 responsive/reduced-motion, inline range/instruction persistence, profile, host presence, pause/resume, interruption recovery, reset/erase, local-only network, clean console, and screenshot.\n');
} finally {
  await cli('close').catch(() => {});
  await dashboard.close();
  await rm(dir, { recursive: true, force: true });
}
