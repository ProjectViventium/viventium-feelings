import { ApiError, api } from './api.js';
import { renderBands, renderProfiles, renderTrail, updateBandReadings } from './render.js';

const elements = Object.fromEntries([
  'bands', 'profiles', 'trailList', 'innerState', 'healthDot', 'healthText', 'activeProfile',
  'stateVersion', 'activeHost', 'hostBadge', 'powerToggle', 'powerLabel', 'freshness',
  'reactionInstruction', 'instructionCount', 'saveInstruction', 'resetButton', 'pauseButton',
  'eraseButton', 'bandDialog', 'bandDialogTitle', 'bandDescription', 'currentInput',
  'currentOutput', 'natureInput', 'natureOutput', 'halfLifeInput', 'bandEnabled', 'saveBand',
  'rangePrompts', 'confirmDialog', 'confirmTitle', 'confirmText', 'confirmAction', 'toast',
  'onboardingDialog',
].map((id) => [id, document.getElementById(id)]));

let state;
let host;
let selectedBandId;
let confirming;
let pollTimer;
let onboardingShown = false;

function displaySignature(value) {
  if (!value) return '';
  return JSON.stringify({
    version: value.version,
    enabled: value.enabled,
    health: value.reactionHealth.status,
    healthError: value.reactionHealth.lastErrorClass,
    healthSkip: value.reactionHealth.lastSkipReason,
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

function updateFreshness(value) {
  elements.freshness.textContent = `Live · updated ${new Date(value.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

function render(next, nextHost = host) {
  const previous = state;
  state = next;
  host = nextHost;
  renderBands(elements.bands, state, openBand, previous);
  renderProfiles(elements.profiles, state, confirmProfile);
  renderTrail(elements.trailList, state);
  elements.innerState.textContent = state.innerState?.text ?? 'No reaction yet.';
  elements.innerState.classList.toggle('empty', !state.innerState);
  elements.healthText.textContent = healthCopy(state.reactionHealth);
  elements.healthDot.dataset.status = state.reactionHealth.status;
  elements.activeProfile.textContent = profileName();
  elements.stateVersion.textContent = `v${state.version}`;
  elements.activeHost.textContent = host === 'claude' ? 'Claude Code' : host === 'codex' ? 'Codex' : 'Local';
  elements.hostBadge.textContent = elements.activeHost.textContent;
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

async function refresh({ quiet = false, force = false } = {}) {
  try {
    const result = await api.state();
    if (!force && state && displaySignature(state) === displaySignature(result.state)) {
      updateBandReadings(elements.bands, result.state);
      state = result.state;
      host = result.host;
      updateFreshness(state);
    } else {
      render(result.state, result.host);
    }
  } catch (error) {
    elements.freshness.textContent = 'Connection interrupted';
    if (!quiet) toast('Dashboard connection interrupted.', 'error');
  }
}

async function mutate(action, success) {
  try {
    const result = await action();
    if (result.state) render(result.state);
    else await refresh({ quiet: true });
    toast(success);
  } catch (error) {
    if (state) render(state, host);
    if (error instanceof ApiError && error.status === 409) {
      await refresh({ quiet: true, force: true });
      toast('State changed elsewhere. Refreshed—please try once more.', 'error');
    } else if (error instanceof ApiError && error.code === 'capsule_limit') {
      toast('Active feeling language is too long for host context. Shorten the active additions.', 'error');
    } else {
      toast('That change could not be saved.', 'error');
    }
  }
}

function openBand(bandId) {
  selectedBandId = bandId;
  const definition = state.definitions.find((item) => item.id === bandId);
  const band = state.bands[bandId];
  elements.bandDialogTitle.textContent = definition.name;
  elements.bandDescription.textContent = definition.description;
  elements.currentInput.value = band.current;
  elements.natureInput.value = band.baseline;
  elements.halfLifeInput.value = band.halfLifeMinutes;
  elements.bandEnabled.checked = band.enabled;
  renderRangePrompts(definition, state.rangePromptOverrides[bandId] ?? {});
  updateBandOutputs();
  elements.bandDialog.showModal();
}

function renderRangePrompts(definition, overrides) {
  const fragment = document.createDocumentFragment();
  for (const level of definition.levels) {
    const wrapper = document.createElement('label');
    wrapper.className = 'range-prompt';
    const title = document.createElement('span');
    title.textContent = `${level.min}–${level.max} · ${level.word}`;
    const builtIn = document.createElement('small');
    builtIn.textContent = level.instruction;
    const input = document.createElement('textarea');
    input.rows = 2;
    input.maxLength = 1200;
    input.dataset.levelId = level.id;
    input.value = overrides[level.id] ?? '';
    input.placeholder = 'Optional addition';
    wrapper.append(title, builtIn, input);
    fragment.append(wrapper);
  }
  elements.rangePrompts.replaceChildren(fragment);
}

function updateBandOutputs() {
  elements.currentOutput.textContent = Math.round(elements.currentInput.value);
  elements.natureOutput.textContent = Math.round(elements.natureInput.value);
}

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
elements.currentInput.addEventListener('input', updateBandOutputs);
elements.natureInput.addEventListener('input', updateBandOutputs);
elements.saveBand.addEventListener('click', (event) => {
  event.preventDefault();
  elements.bandDialog.close();
  mutate(() => api.band(state.version, selectedBandId, {
    current: Number(elements.currentInput.value),
    baseline: Number(elements.natureInput.value),
    halfLifeMinutes: Number(elements.halfLifeInput.value),
    enabled: elements.bandEnabled.checked,
    rangePromptOverrides: Object.fromEntries(
      [...elements.rangePrompts.querySelectorAll('textarea')]
        .map((input) => [input.dataset.levelId, input.value.trim() || null]),
    ),
  }), 'Feeling updated.');
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
  title: 'Erase all local Feelings data?', text: 'This permanently removes state, trail, reactions, queue metadata, audit, and local keys. Feelings will remain off.',
  label: 'Erase everything', dangerous: true,
  run: () => {
    onboardingShown = false;
    return mutate(() => api.erase(state.version), 'Local Feelings data erased.');
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
pollTimer = setInterval(() => refresh({ quiet: true }), 2000);
