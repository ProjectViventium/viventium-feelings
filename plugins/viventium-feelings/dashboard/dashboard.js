import { ApiError, api } from './api.js';
import { renderBands, renderProfiles, renderTrail, updateBandReadings } from './render.js';

const elements = Object.fromEntries([
  'bands', 'profiles', 'trailList', 'innerState', 'healthDot', 'healthText', 'activeProfile',
  'stateVersion', 'activeHost', 'hostBadge', 'powerToggle', 'powerLabel', 'freshness',
  'reactionInstruction', 'instructionCount', 'saveInstruction', 'resetButton', 'pauseButton',
  'eraseButton', 'confirmDialog', 'confirmTitle', 'confirmText', 'confirmAction', 'toast',
  'onboardingDialog', 'themeToggle', 'themeColor', 'hostPresenceButton', 'hostPresenceTitle',
  'hostPresenceHelp', 'hostPresenceLabel',
].map((id) => [id, document.getElementById(id)]));

let state;
let host;
let confirming;
let pollTimer;
let onboardingShown = false;
let statusPresence;

// Focus and pending writes are separate: moving among controls within one band
// must not increment a shared counter and leave the lane permanently stale.
// Polls preserve the union so they cannot fight focus, drafts, or queued writes.
const focusedBands = new Set();
const pendingEdits = new Map();
const beginEdit = (id) => pendingEdits.set(id, (pendingEdits.get(id) || 0) + 1);
const endEdit = (id) => {
  const next = (pendingEdits.get(id) || 0) - 1;
  if (next > 0) pendingEdits.set(id, next); else pendingEdits.delete(id);
};
const interactingBands = () => new Set([...focusedBands, ...pendingEdits.keys()]);
const hasActiveEdits = () => focusedBands.size > 0 || pendingEdits.size > 0;

// Expand state + unsaved range drafts survive re-renders.
const ui = { expanded: new Set(), drafts: new Map() };

// ---- Theme (system by default; explicit override wins) --------------------
const THEME_ORDER = ['system', 'light', 'dark'];
let activeTheme = window.__VIVENTIUM_INITIAL_THEME__ ?? 'system';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function svgEl(tag, attrs) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attrs)) element.setAttribute(key, val);
  return element;
}

function themeIcon(choice) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' });
  const stroke = { stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (choice === 'dark') {
    svg.append(svgEl('path', { d: 'M20 14.5A7.5 7.5 0 1 1 10.5 4a6 6 0 0 0 9.5 10.5Z', ...stroke }));
  } else if (choice === 'light') {
    svg.append(svgEl('circle', { cx: '12', cy: '12', r: '4.2', ...stroke }));
    for (const [x1, y1, x2, y2] of [
      [12, 2.5, 12, 4.5], [12, 19.5, 12, 21.5], [2.5, 12, 4.5, 12], [19.5, 12, 21.5, 12],
      [5.2, 5.2, 6.6, 6.6], [17.4, 17.4, 18.8, 18.8], [17.4, 5.2, 18.8, 6.6], [5.2, 17.4, 6.6, 18.8],
    ]) svg.append(svgEl('line', { x1, y1, x2, y2, ...stroke }));
  } else {
    svg.append(svgEl('circle', { cx: '12', cy: '12', r: '8.4', ...stroke }));
    svg.append(svgEl('path', { d: 'M12 3.6a8.4 8.4 0 0 1 0 16.8Z', fill: 'currentColor' }));
  }
  return svg;
}

function applyTheme(choice) {
  activeTheme = THEME_ORDER.includes(choice) ? choice : 'system';
  if (activeTheme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', activeTheme);
  const resolved = activeTheme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : activeTheme;
  elements.themeColor.content = resolved === 'dark' ? '#0e0e10' : '#f7f7f5';
  const label = { system: 'match system', light: 'light', dark: 'dark' }[activeTheme];
  elements.themeToggle.setAttribute('aria-label', `Theme: ${label}. Activate to change.`);
  elements.themeToggle.title = `Theme: ${label}`;
  elements.themeToggle.replaceChildren(themeIcon(activeTheme));
}

elements.themeToggle.addEventListener('click', async () => {
  const previous = activeTheme;
  const next = THEME_ORDER[(THEME_ORDER.indexOf(activeTheme) + 1) % THEME_ORDER.length];
  applyTheme(next);
  try {
    await api.theme(next);
  } catch {
    applyTheme(previous);
    toast('Theme preference could not be saved.', 'error');
  }
});
systemTheme.addEventListener('change', () => {
  if (activeTheme === 'system') applyTheme('system');
});
applyTheme(activeTheme);

// ---- Helpers ---------------------------------------------------------------
function displaySignature(value) {
  if (!value) return '';
  return JSON.stringify({
    version: value.version,
    enabled: value.enabled,
    profileId: value.profileId,
    health: value.reactionHealth.status,
    healthError: value.reactionHealth.lastErrorClass,
    healthSkip: value.reactionHealth.lastSkipReason,
    inner: value.innerState?.generatedAt ?? null,
  });
}

function toast(message, tone = 'normal') {
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add('visible');
  setTimeout(() => elements.toast.classList.remove('visible'), 2600);
}

function profileName() {
  return state.profiles[state.profileId]?.name ?? 'Custom';
}

function healthCopy(health) {
  if (health.status === 'skipped') {
    const skipped = {
      disabled: 'Reactions paused',
      duplicate: 'Duplicate reaction safely ignored',
      cancelled_by_control: 'Reaction cancelled after a setting changed',
      completion_timeout: 'Reaction window expired after 30 minutes',
      reaction_queue_full: 'Reaction queue full; feeling context still active',
    };
    return skipped[health.lastSkipReason] ?? 'Latest reaction safely skipped';
  }
  const degraded = {
    provider_rate_limit: 'Reaction paused by provider usage limit',
    provider_auth_missing: 'Reaction needs provider sign-in',
    provider_model_unavailable: 'Reaction model is unavailable',
    reaction_queue_timeout: 'Reaction queue could not drain in time',
    reaction_coordination_failed: 'Reaction coordination needs a retry',
    reaction_commit_failed: 'Reaction could not save its latest state',
    capsule_limit: 'Feeling language exceeded the host context budget',
  };
  const copy = {
    never: 'Waiting for first reaction', running: 'Reaction in progress', healthy: 'Reaction cortex healthy',
    degraded: degraded[health.lastErrorClass] ?? 'Last reaction could not complete',
  };
  return copy[health.status] ?? 'Reaction status unavailable';
}

function syncInspector() {
  elements.innerState.textContent = state.innerState?.text ?? 'No reaction yet.';
  elements.innerState.classList.toggle('empty', !state.innerState);
  elements.healthText.textContent = healthCopy(state.reactionHealth);
  elements.healthDot.dataset.status = state.reactionHealth.status;
  elements.activeProfile.textContent = profileName();
  elements.stateVersion.textContent = `v${state.version}`;
  const hostName = host === 'claude' ? 'Claude Code' : host === 'codex' ? 'Codex' : 'Local';
  elements.activeHost.textContent = hostName;
  elements.hostBadge.textContent = hostName;
  elements.powerToggle.checked = state.enabled;
  elements.powerLabel.textContent = state.enabled ? 'On' : 'Off';
  elements.pauseButton.querySelector('b').textContent = state.enabled ? 'Pause' : 'Resume';
  if (document.activeElement !== elements.reactionInstruction) elements.reactionInstruction.value = state.reactionInstruction;
  updateCount();
  updateFreshness(state);
  document.body.classList.toggle('feelings-off', !state.enabled);
  if (!onboardingShown && state.version === 0 && !state.enabled) {
    onboardingShown = true;
    elements.onboardingDialog.showModal();
  }
}

function syncStatusPresence() {
  if (!statusPresence) return;
  const isClaude = statusPresence.host === 'claude';
  elements.hostPresenceTitle.textContent = isClaude ? 'Claude status line' : 'Codex V identity';
  elements.hostPresenceHelp.textContent = statusPresence.message;
  const labels = {
    available: 'Add V', enabled: 'Remove', conflict: 'Already used',
    native_branding: 'Included', unsupported: 'Unavailable',
  };
  elements.hostPresenceLabel.textContent = labels[statusPresence.status] ?? 'Unavailable';
  elements.hostPresenceButton.disabled = !['available', 'enabled'].includes(statusPresence.status);
}

async function refreshStatusPresence({ quiet = true } = {}) {
  try {
    statusPresence = await api.statusPresence();
    syncStatusPresence();
  } catch {
    elements.hostPresenceHelp.textContent = 'Host presence could not be checked.';
    elements.hostPresenceLabel.textContent = 'Unavailable';
    elements.hostPresenceButton.disabled = true;
    if (!quiet) toast('Host presence could not be checked.', 'error');
  }
}

function updateFreshness(value) {
  elements.freshness.textContent = `Live · updated ${new Date(value.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

function captureBandFocus() {
  const active = document.activeElement;
  const band = active?.closest?.('.band');
  const focusKey = active?.dataset?.focusKey;
  return band && focusKey ? { bandId: band.dataset.band, focusKey } : null;
}

function restoreBandFocus(descriptor) {
  if (!descriptor) return null;
  const band = elements.bands.querySelector(`.band[data-band="${CSS.escape(descriptor.bandId)}"]`);
  const control = band?.querySelector(`[data-focus-key="${CSS.escape(descriptor.focusKey)}"]`);
  control?.focus({ preventScroll: true });
  return control ?? null;
}

// Full render: rebuild the instrument (expand + drafts re-applied from ui).
function render(next, nextHost = host) {
  const priorFocus = captureBandFocus();
  const previous = state;
  state = next;
  host = nextHost;
  renderBands(elements.bands, state, handlers, ui, previous);
  renderProfiles(elements.profiles, state, confirmProfile);
  renderTrail(elements.trailList, state);
  syncInspector();
  // Rebuilding removes the focused DOM node and browsers emit no focusout for
  // that removal. Reconcile the ledger and return focus to the equivalent field.
  focusedBands.clear();
  if (restoreBandFocus(priorFocus)) focusedBands.add(priorFocus.bandId);
}

// Light update: reuse the existing DOM (no re-animation, keeps focus/drafts).
function lightUpdate(next, { forceBands = [] } = {}) {
  const previous = state;
  state = next;
  const interacting = interactingBands();
  for (const bandId of forceBands) interacting.delete(bandId);
  updateBandReadings(elements.bands, state, { interacting, previous });
  renderProfiles(elements.profiles, state, confirmProfile);
  renderTrail(elements.trailList, state);
  syncInspector();
}

async function refresh({ quiet = false, force = false, forceBands = [] } = {}) {
  try {
    const result = await api.state();
    if (result.preferences?.theme && result.preferences.theme !== activeTheme) applyTheme(result.preferences.theme);
    if (state && elements.bands.querySelector('.band')
        && (hasActiveEdits() || (!force && displaySignature(state) === displaySignature(result.state)))) {
      const previous = state;
      state = result.state;
      host = result.host;
      const interacting = interactingBands();
      for (const bandId of forceBands) interacting.delete(bandId);
      updateBandReadings(elements.bands, state, { interacting, previous });
      renderProfiles(elements.profiles, state, confirmProfile);
      renderTrail(elements.trailList, state);
      syncInspector();
    } else {
      render(result.state, result.host);
    }
  } catch (error) {
    elements.freshness.textContent = 'Connection interrupted';
    if (!quiet) toast('Dashboard connection interrupted.', 'error');
  }
}

async function mutate(action, success, { light = false, rollbackBands = [] } = {}) {
  try {
    const result = await action();
    if (result.state) {
      if (light && elements.bands.querySelector('.band')) lightUpdate(result.state);
      else render(result.state);
    } else {
      await refresh({ quiet: true });
    }
    toast(typeof success === 'function' ? success(result) : success);
    return true;
  } catch (error) {
    if (state) {
      if (light) lightUpdate(state, { forceBands: rollbackBands }); else render(state, host);
    }
    if (error instanceof ApiError && error.status === 409) {
      await refresh({ quiet: true, force: true, forceBands: rollbackBands });
      toast('State changed elsewhere. Refreshed—please try once more.', 'error');
    } else if (error instanceof ApiError && error.code === 'capsule_limit') {
      toast('Active feeling language is too long for host context. Shorten the active additions.', 'error');
    } else {
      toast('That change could not be saved.', 'error');
    }
    return false;
  }
}

// Band commits are serialized: inline editing makes rapid edits across lanes the
// happy path, and each PATCH must read the version produced by the one before it.
// beginEdit runs immediately so a queued commit still shields its lane from polls.
let bandCommitChain = Promise.resolve();

function commitBand(bandId, patch, success, { light }) {
  beginEdit(bandId);
  const run = async () => {
    try {
      return await mutate(() => api.band(state.version, bandId, patch), success, {
        light,
        rollbackBands: [bandId],
      });
    } finally {
      endEdit(bandId);
    }
  };
  bandCommitChain = bandCommitChain.then(run, run);
  return bandCommitChain;
}

// Handlers passed to the renderer.
const handlers = {
  beginInteraction() {}, // editing is tracked by focus + commit; this is a no-op hook
  commit(bandId, kind, value) {
    const patch = kind === 'current' ? { current: value } : { baseline: value };
    const message = kind === 'current' ? 'Now updated.' : 'Nature updated.';
    return commitBand(bandId, patch, message, { light: true });
  },
  commitField(bandId, patch, message) {
    return commitBand(bandId, patch, message, { light: false });
  },
  resetLane(bandId) {
    return commitBand(bandId, { reset: true }, 'Lane reset to Nature.', { light: false });
  },
  saveRange(bandId, levelId, text) {
    return commitBand(
      bandId,
      { rangePromptOverrides: { [levelId]: text } },
      text ? 'Range language saved.' : 'Range language cleared.',
      { light: false },
    );
  },
};

// Focus tracking is lane-based, not control-based. Focus movement inside one
// lane is idempotent; only entering/leaving the lane changes the set.
elements.bands.addEventListener('focusin', (event) => {
  const band = event.target.closest('.band');
  if (band) focusedBands.add(band.dataset.band);
});
elements.bands.addEventListener('focusout', (event) => {
  const band = event.target.closest('.band');
  if (band && !band.contains(event.relatedTarget)) focusedBands.delete(band.dataset.band);
});

function confirmAction({ title, text, label, run, dangerous = false }) {
  confirming = run;
  elements.confirmTitle.textContent = title;
  elements.confirmText.textContent = text;
  elements.confirmAction.textContent = label;
  elements.confirmAction.className = dangerous ? 'danger-button' : 'primary-button';
  elements.confirmDialog.showModal();
}

function confirmProfile(id, name) {
  confirmAction({
    title: `Apply ${name} Nature?`,
    text: 'This changes all nine resting values and resets Current to that Nature. Your previous trail remains visible.',
    label: `Apply ${name}`,
    run: () => mutate(() => api.profile(state.version, id), `${name} Nature applied.`),
  });
}

function updateCount() {
  elements.instructionCount.textContent = `${elements.reactionInstruction.value.length} / 4000`;
}

elements.powerToggle.addEventListener('change', () => mutate(
  () => api.enabled(state.version, elements.powerToggle.checked),
  elements.powerToggle.checked ? 'Feelings enabled.' : 'Feelings paused.',
));
elements.pauseButton.addEventListener('click', () => mutate(
  () => api.enabled(state.version, !state.enabled),
  state.enabled ? 'Feelings paused.' : 'Feelings resumed.',
));
elements.hostPresenceButton.addEventListener('click', async () => {
  if (!statusPresence || !['available', 'enabled'].includes(statusPresence.status)) return;
  const action = statusPresence.status === 'enabled' ? 'disable' : 'enable';
  elements.hostPresenceButton.disabled = true;
  try {
    statusPresence = await api.setStatusPresence(action);
    syncStatusPresence();
    toast(action === 'enable' ? 'V added to the Claude status line.' : 'V removed from the Claude status line.');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'status_line_conflict') {
      toast('Claude already has a custom status line; nothing was overwritten.', 'error');
    } else {
      toast('Host presence could not be changed.', 'error');
    }
    await refreshStatusPresence();
  }
});
elements.reactionInstruction.addEventListener('input', updateCount);
elements.saveInstruction.addEventListener('click', () => mutate(
  () => api.settings(state.version, { reactionInstruction: elements.reactionInstruction.value }),
  'Reaction instruction saved.',
));
elements.resetButton.addEventListener('click', () => confirmAction({
  title: 'Reset Current to Nature?', text: 'All nine live feelings return to their resting values. Your trail remains visible.',
  label: 'Reset Current', run: () => mutate(() => api.reset(state.version), 'Current reset to Nature.'),
}));
elements.eraseButton.addEventListener('click', () => confirmAction({
  title: 'Erase Feelings from this host?', text: 'This permanently removes state, trail, reactions, queue metadata, audit, local keys, and any Viventium-owned Claude status line. Other status lines and host chats are never changed.',
  label: 'Erase everything', dangerous: true,
  run: () => {
    onboardingShown = false;
    return mutate(
      () => api.erase(state.version),
      (result) => result.statusPresence?.status === 'cleanup_failed'
        ? 'Feelings data erased. Remove V from Claude manually before uninstalling.'
        : 'Feelings data and owned host presence erased.',
    ).then(async (saved) => {
      if (saved) await refreshStatusPresence();
      return saved;
    });
  },
}));
elements.confirmAction.addEventListener('click', (event) => {
  event.preventDefault();
  elements.confirmDialog.close();
  const run = confirming;
  confirming = null;
  run?.();
});

document.addEventListener('visibilitychange', () => {
  clearInterval(pollTimer);
  if (!document.hidden) {
    refresh({ quiet: true });
    pollTimer = setInterval(() => refresh({ quiet: true }), 2000);
  }
});

await refresh();
await refreshStatusPresence();
pollTimer = setInterval(() => refresh({ quiet: true }), 2000);
