// DOM construction + inline interaction for the Feelings instrument.
// The fundamental interaction — see Now vs Nature and change either — lives on the
// band row itself (draggable/keyboard thumbs). Return speed, enable, and the five
// range additions live in a one-click inline drawer. No modal is used for tuning.

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const num = (value) => Number.parseFloat(value) || 0;
const value = (n) => Math.round(n);
const clampPct = (n) => Math.min(100, Math.max(0, n));
const signed = (n) => `${n > 0 ? '+' : ''}${Math.round(n)}`;

function levelFor(definition, current) {
  return definition.levels.find((level) => current >= level.min && current <= level.max)
    ?? definition.levels.at(-1);
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// ---- Interactive dual-thumb track -----------------------------------------

function buildTrack(definition, band, handlers) {
  const track = node('div', 'band-track');
  track.dataset.band = definition.id;
  track.dataset.current = String(band.current);
  track.dataset.nature = String(band.baseline);

  const rail = node('span', 'track-rail');
  const fill = node('span', 'track-fill');
  const nature = node('span', 'thumb nature');
  const current = node('span', 'thumb current');
  const poles = node('span', 'track-poles');
  const low = definition.levels[0]?.word ?? 'low';
  const high = definition.levels.at(-1)?.word ?? 'high';
  poles.append(node('span', '', low), node('span', '', high));

  for (const [el, kind, label] of [[nature, 'nature', 'Nature'], [current, 'current', 'Now']]) {
    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.setAttribute('aria-label', `${definition.name} ${label}`);
    el.dataset.kind = kind;
    el.dataset.focusKey = `thumb:${kind}`;
  }
  track.append(rail, fill, nature, current, poles);

  const refs = { track, fill, nature, current };
  paint(definition, refs);

  const setValueLive = (kind, pct) => {
    track.dataset[kind] = String(pct);
    paint(definition, refs);
  };

  const timers = { current: null, nature: null };
  const keyboardOrigins = { current: null, nature: null };

  // Pointer: a thumb press always selects that exact control. A rail press uses
  // proximity. This matters when Now equals Nature: both remain independently
  // reachable rather than the tie always falling through to Now.
  // pointerup commits; pointercancel (e.g. the browser claiming a vertical
  // scroll on touch) reverts, so a scroll attempt can never mutate a feeling.
  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = track.getBoundingClientRect();
    const pct = clampPct(((event.clientX - rect.left) / rect.width) * 100);
    const pressedThumb = event.target.closest?.('.thumb');
    let kind = pressedThumb?.dataset.kind ?? (
      Math.abs(pct - num(track.dataset.current)) <= Math.abs(pct - num(track.dataset.nature))
        ? 'current' : 'nature'
    );
    // Both controls keep generous hit areas. When their horizontal hit regions
    // overlap, use the two visible marker rows to resolve intent; otherwise the
    // higher-z Nature halo can steal a press on the upper half of the Now dot.
    const currentX = rect.left + (num(track.dataset.current) / 100) * rect.width;
    const natureX = rect.left + (num(track.dataset.nature) / 100) * rect.width;
    const hitRadius = 22;
    if (Math.abs(event.clientX - currentX) <= hitRadius
        && Math.abs(event.clientX - natureX) <= hitRadius) {
      const rowBoundary = rect.top + ((current.offsetTop + nature.offsetTop) / 2);
      kind = event.clientY <= rowBoundary ? 'nature' : 'current';
    }

    // A pointer gesture supersedes a still-debounced keyboard gesture on this
    // control. Revert that provisional keyboard value before taking the drag
    // snapshot, so cancel means authoritative state and pointerup means one write.
    if (timers[kind]) {
      clearTimeout(timers[kind]);
      timers[kind] = null;
      track.dataset[kind] = keyboardOrigins[kind] ?? track.dataset[kind];
      keyboardOrigins[kind] = null;
      paint(definition, refs);
    }
    const originals = { current: track.dataset.current, nature: track.dataset.nature };
    const thumb = kind === 'current' ? current : nature;
    thumb.focus({ preventScroll: true });
    track.classList.add('dragging');
    handlers.beginInteraction(definition.id);
    try { track.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    setValueLive(kind, pct);
    const move = (moveEvent) => setValueLive(kind, clampPct(((moveEvent.clientX - rect.left) / rect.width) * 100));
    const finish = (commit) => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onCancel);
      track.classList.remove('dragging');
      if (commit) {
        handlers.commit(definition.id, kind, value(num(track.dataset[kind])));
      } else {
        track.dataset.current = originals.current;
        track.dataset.nature = originals.nature;
        paint(definition, refs);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onCancel);
    event.preventDefault();
  });

  // Keyboard: arrows ±1, PageUp/Down ±10, Home/End; committed after a short pause.
  for (const [thumb, kind] of [[current, 'current'], [nature, 'nature']]) {
    thumb.addEventListener('keydown', (event) => {
      const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      let next;
      if (event.key in steps) next = clampPct(value(num(track.dataset[kind])) + steps[event.key]);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      else return;
      event.preventDefault();
      handlers.beginInteraction(definition.id);
      if (!timers[kind]) keyboardOrigins[kind] = track.dataset[kind];
      setValueLive(kind, next);
      clearTimeout(timers[kind]);
      timers[kind] = setTimeout(() => {
        timers[kind] = null;
        keyboardOrigins[kind] = null;
        handlers.commit(definition.id, kind, value(next));
      }, 320);
    });
    thumb.addEventListener('blur', () => {
      if (timers[kind]) {
        clearTimeout(timers[kind]);
        timers[kind] = null;
        keyboardOrigins[kind] = null;
        handlers.commit(definition.id, kind, value(num(track.dataset[kind])));
      }
    });
  }

  return { element: track, refs };
}

// Position both thumbs, the fill, and ARIA from the track's dataset.
function paint(definition, refs) {
  const current = clampPct(num(refs.track.dataset.current));
  const nature = clampPct(num(refs.track.dataset.nature));
  const start = Math.min(current, nature);
  refs.fill.style.left = `${start}%`;
  refs.fill.style.width = `${Math.max(Math.abs(current - nature), 0.4)}%`;
  refs.current.style.left = `${current}%`;
  refs.nature.style.left = `${nature}%`;
  const word = levelFor(definition, current).word;
  refs.current.setAttribute('aria-valuenow', String(value(current)));
  refs.current.setAttribute('aria-valuetext', `${value(current)} of 100 — ${word}`);
  refs.nature.setAttribute('aria-valuenow', String(value(nature)));
  refs.nature.setAttribute('aria-valuetext', `${value(nature)} of 100 resting`);

  // Keep the readout in step with the thumbs, including live drag/keyboard.
  const bandEl = refs.track.closest('.band');
  if (bandEl) {
    const readingValue = bandEl.querySelector('.band-reading [data-value="current"]');
    const next = String(value(current));
    if (readingValue && readingValue.textContent !== next) readingValue.textContent = next;
    const natureValue = bandEl.querySelector('.band-reading [data-value="nature"]');
    if (natureValue) natureValue.textContent = String(value(nature));
    const small = bandEl.querySelector('.band-reading .level-word');
    if (small) small.textContent = word;
    const delta = bandEl.querySelector('.band-reading .delta');
    if (delta) delta.textContent = `${signed(current - nature)} vs Nature`;
  }
}

// ---- Advanced drawer (return speed, enable, five ranges) -------------------

function buildAdvanced(definition, band, overrides, handlers, ui) {
  const drawer = node('div', 'band-advanced');
  drawer.id = `adv-${definition.id}`;
  const clip = node('div', 'adv-clip');
  const inner = node('div', 'band-advanced-inner');

  const controls = node('div', 'adv-controls');

  const natureField = node('div', 'adv-field');
  const natureLabel = node('label', '', 'Nature (resting value)');
  natureLabel.htmlFor = `nature-${definition.id}`;
  const natureInline = node('div', 'adv-inline');
  const natureInput = node('input');
  natureInput.type = 'number'; natureInput.min = '0'; natureInput.max = '100'; natureInput.step = '1';
  natureInput.id = `nature-${definition.id}`;
  natureInput.value = String(value(band.baseline));
  natureInput.dataset.role = 'nature';
  natureInput.dataset.focusKey = 'nature';
  natureInput.addEventListener('change', () => {
    const next = clampPct(num(natureInput.value));
    natureInput.value = String(value(next));
    handlers.commitField(definition.id, { baseline: value(next) }, 'Nature updated.');
  });
  const resetLane = node('button', 'link-button', 'Reset lane to Nature');
  resetLane.type = 'button';
  resetLane.dataset.focusKey = 'reset';
  resetLane.addEventListener('click', () => handlers.resetLane(definition.id));
  natureInline.append(natureInput, resetLane);
  natureField.append(natureLabel, natureInline);

  const halfField = node('div', 'adv-field');
  const halfLabel = node('label', '', 'Return speed — half-life (minutes)');
  halfLabel.htmlFor = `half-${definition.id}`;
  const halfInput = node('input');
  halfInput.type = 'number'; halfInput.min = '1'; halfInput.max = '525600'; halfInput.step = '1';
  halfInput.id = `half-${definition.id}`;
  halfInput.value = String(value(band.halfLifeMinutes));
  halfInput.dataset.role = 'halfLife';
  halfInput.dataset.focusKey = 'halfLife';
  halfInput.addEventListener('change', () => {
    const next = Math.min(525600, Math.max(1, value(num(halfInput.value))));
    halfInput.value = String(next);
    handlers.commitField(definition.id, { halfLifeMinutes: next }, 'Return speed updated.');
  });
  const halfHint = node('p', 'hint', 'Current moves halfway back toward Nature every half-life.');
  halfField.append(halfLabel, halfInput, halfHint);

  const enableRow = node('label', 'check-row');
  const enableInput = node('input');
  enableInput.type = 'checkbox';
  enableInput.checked = band.enabled;
  enableInput.dataset.role = 'enabled';
  enableInput.dataset.focusKey = 'enabled';
  enableInput.addEventListener('change', () => handlers.commitField(
    definition.id,
    { enabled: enableInput.checked },
    enableInput.checked ? 'Lane included in Feelings.' : 'Lane paused.',
  ));
  enableRow.append(enableInput, node('span', '', 'Include this lane in Feelings'));

  controls.append(natureField, halfField, enableRow);

  const ranges = node('div', 'ranges');
  ranges.append(node('p', 'ranges-title', 'Range embodiment — optional private language added only while Now sits in that range.'));
  const activeLevel = levelFor(definition, band.current);
  for (const level of definition.levels) {
    ranges.append(buildRangeRow(definition, level, overrides[level.id] ?? '', activeLevel.id === level.id, handlers, ui));
  }

  inner.append(controls, ranges);
  clip.append(inner);
  drawer.append(clip);
  if (ui.expanded.has(definition.id)) drawer.classList.add('open');
  else clip.setAttribute('inert', '');
  return drawer;
}

function buildRangeRow(definition, level, savedValue, isActive, handlers, ui) {
  const draftKey = `${definition.id}:${level.id}`;
  const draft = ui.drafts.has(draftKey) ? ui.drafts.get(draftKey) : savedValue;
  const row = node('div', `range-row${isActive ? ' active' : ''}`);
  const head = node('div', 'range-head');
  head.append(node('strong', '', `${level.min}–${level.max} · ${level.word}`));
  if (isActive) head.append(node('span', 'tag', 'Now'));
  const builtIn = node('small', '', level.instruction);
  const textarea = node('textarea');
  textarea.rows = 2; textarea.maxLength = 1200;
  textarea.placeholder = 'Optional addition';
  textarea.value = draft;
  textarea.dataset.levelId = level.id;
  textarea.dataset.focusKey = `range:${level.id}:text`;
  const actions = node('div', 'range-actions');
  const count = node('span', 'count', `${draft.length} / 1200`);
  const buttons = node('div', 'adv-inline');
  const save = node('button', 'quiet-button', 'Save');
  save.type = 'button';
  save.dataset.focusKey = `range:${level.id}:save`;
  const restore = node('button', 'link-button', 'Clear');
  restore.type = 'button';
  restore.dataset.focusKey = `range:${level.id}:clear`;
  buttons.append(restore, save);
  actions.append(count, buttons);

  textarea.addEventListener('input', () => {
    count.textContent = `${textarea.value.length} / 1200`;
    ui.drafts.set(draftKey, textarea.value);
  });
  save.addEventListener('click', async () => {
    const text = textarea.value.trim();
    const saved = await handlers.saveRange(definition.id, level.id, text ? text : null);
    if (saved) ui.drafts.delete(draftKey);
  });
  restore.addEventListener('click', async () => {
    textarea.value = '';
    count.textContent = '0 / 1200';
    ui.drafts.set(draftKey, '');
    const saved = await handlers.saveRange(definition.id, level.id, null);
    if (saved) ui.drafts.delete(draftKey);
  });

  row.append(head, builtIn, textarea, actions);
  return row;
}

// ---- Band assembly ---------------------------------------------------------

function renderBand(definition, band, overrides, handlers, ui, previous) {
  const container = node('div', 'band');
  container.dataset.band = definition.id;
  container.style.setProperty('--band-color', definition.color);

  const row = node('div', 'band-row');

  const identity = node('div', 'band-identity');
  identity.append(node('span', 'signal'), node('strong', '', definition.name), node('small', '', definition.description));

  const { element: track } = buildTrack(definition, band, handlers);

  const reading = node('div', 'band-reading');
  const currentReading = node('span', 'reading-value current-reading');
  const currentLabel = node('small', '', 'Now');
  const currentValue = node('b', '', String(value(band.current)));
  currentValue.dataset.value = 'current';
  if (previous !== undefined && value(previous) !== value(band.current)) currentValue.classList.add('changed');
  currentReading.append(currentLabel, currentValue);
  const natureReading = node('span', 'reading-value nature-reading');
  const natureLabel = node('small', '', 'Nature');
  const natureValue = node('b', '', String(value(band.baseline)));
  natureValue.dataset.value = 'nature';
  natureReading.append(natureLabel, natureValue);
  const readingMeta = node('span', 'reading-meta');
  readingMeta.append(
    node('small', 'level-word', levelFor(definition, band.current).word),
    node('span', 'delta', `${signed(band.current - band.baseline)} vs Nature`),
  );
  reading.append(currentReading, natureReading, readingMeta);

  const expand = node('button', 'expand-btn');
  expand.type = 'button';
  expand.setAttribute('aria-controls', `adv-${definition.id}`);
  expand.setAttribute('aria-expanded', ui.expanded.has(definition.id) ? 'true' : 'false');
  expand.setAttribute('aria-label', `More options for ${definition.name}`);
  expand.dataset.focusKey = 'expand';
  expand.append(chevron());

  row.append(identity, track, reading, expand);
  const drawer = buildAdvanced(definition, band, overrides, handlers, ui);

  expand.addEventListener('click', () => {
    const open = !ui.expanded.has(definition.id);
    const clip = drawer.firstElementChild;
    if (open) {
      ui.expanded.add(definition.id);
      drawer.classList.add('open');
      clip.removeAttribute('inert');
    } else {
      ui.expanded.delete(definition.id);
      drawer.classList.remove('open');
      clip.setAttribute('inert', '');
    }
    expand.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  container.append(row, drawer);
  return container;
}

export function renderBands(container, state, handlers, ui, previousState) {
  const fragment = document.createDocumentFragment();
  for (const definition of state.definitions) {
    fragment.append(renderBand(
      definition,
      state.bands[definition.id],
      state.rangePromptOverrides[definition.id] ?? {},
      handlers,
      ui,
      previousState?.bands?.[definition.id]?.current,
    ));
  }
  container.replaceChildren(fragment);
  container.setAttribute('aria-busy', 'false');
}

// In-place update from a poll. Skips any band the user is actively editing so a
// background refresh never fights a drag, and re-pulses a lane a reaction moved.
export function updateBandReadings(container, state, { interacting = new Set(), previous } = {}) {
  for (const definition of state.definitions) {
    if (interacting.has(definition.id)) continue;
    const bandEl = container.querySelector(`.band[data-band="${definition.id}"]`);
    if (!bandEl) continue;
    const band = state.bands[definition.id];
    const track = bandEl.querySelector('.band-track');
    track.dataset.current = String(band.current);
    track.dataset.nature = String(band.baseline);
    paint(definition, {
      track,
      fill: track.querySelector('.track-fill'),
      current: track.querySelector('.thumb.current'),
      nature: track.querySelector('.thumb.nature'),
    });

    // paint() (above) already synced the readout text from the dataset; here we
    // only add the arrival pulse when a reaction or reset actually moved Current.
    const before = previous?.bands?.[definition.id]?.current;
    if (before !== undefined && value(before) !== value(band.current)) {
      pulse(bandEl.querySelector('.band-reading [data-value="current"]'), 'changed');
      pulse(track.querySelector('.thumb.current'), 'pulse');
    }

    // Keep the drawer's precise fields honest unless the user is inside it.
    if (!bandEl.contains(document.activeElement)) {
      const nature = bandEl.querySelector('input[data-role="nature"]');
      if (nature) nature.value = String(value(band.baseline));
      const half = bandEl.querySelector('input[data-role="halfLife"]');
      if (half) half.value = String(value(band.halfLifeMinutes));
      const enabled = bandEl.querySelector('input[data-role="enabled"]');
      if (enabled) enabled.checked = band.enabled;
    }
  }
}

function pulse(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth; // restart the animation
  element.classList.add(className);
}

export function renderProfiles(container, state, onApply) {
  const focusedProfile = container.contains(document.activeElement)
    ? document.activeElement.dataset.profileId
    : null;
  const fragment = document.createDocumentFragment();
  for (const [id, profile] of Object.entries(state.profiles)) {
    const button = node('button', `profile-option${state.profileId === id ? ' selected' : ''}`);
    button.type = 'button';
    button.dataset.profileId = id;
    const copy = node('span');
    copy.append(node('strong', '', profile.name), node('small', '', profile.description));
    button.append(copy, node('b', '', state.profileId === id ? 'Active' : 'Apply'));
    button.disabled = state.profileId === id;
    button.addEventListener('click', () => onApply(id, profile.name));
    fragment.append(button);
  }
  if (state.profileId === 'custom') {
    const custom = node('div', 'profile-option selected');
    const copy = node('span');
    copy.append(node('strong', '', 'Custom'), node('small', '', 'Your individually tuned Nature values.'));
    custom.append(copy, node('b', '', 'Active'));
    fragment.append(custom);
  }
  container.replaceChildren(fragment);
  if (focusedProfile) {
    container.querySelector(`[data-profile-id="${CSS.escape(focusedProfile)}"]`)?.focus({ preventScroll: true });
  }
}

export function renderTrail(container, state) {
  if (!state.trail.length) {
    const empty = node('li', 'empty-trail');
    empty.append(node('strong', '', 'Nothing has moved yet.'), node('span', '', 'After a completed reply, a meaningful moment can leave a typed change here.'));
    container.replaceChildren(empty);
    return;
  }
  const names = new Map(state.definitions.map((definition) => [definition.id, definition.name]));
  const fragment = document.createDocumentFragment();
  for (const entry of [...state.trail].reverse().slice(0, 20)) {
    const item = node('li', 'trail-item');
    const time = node('time', '', new Date(entry.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
    time.dateTime = entry.timestamp;
    const change = node('span', 'trail-change');
    change.append(
      node('strong', '', names.get(entry.band) ?? entry.band),
      node('b', entry.direction, `${entry.direction === 'up' ? '↑' : '↓'} ${entry.strength}`),
      node('small', '', entry.cause.replaceAll('_', ' ')),
    );
    item.append(time, change);
    fragment.append(item);
  }
  container.replaceChildren(fragment);
}
