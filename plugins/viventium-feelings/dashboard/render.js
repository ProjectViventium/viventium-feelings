const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const value = (number) => Math.round(number);
const signed = (number) => `${number > 0 ? '+' : ''}${Math.round(number)}`;

function renderBand(definition, band, onOpen, previous) {
  const row = node('button', 'band-row');
  row.type = 'button';
  row.dataset.band = definition.id;
  row.style.setProperty('--band-color', definition.color);
  row.setAttribute('aria-label', `${definition.name}: Current ${value(band.current)}, Nature ${value(band.baseline)}. Tune feeling.`);

  const identity = node('span', 'band-identity');
  identity.append(node('i', 'band-signal'), node('strong', '', definition.name), node('small', '', definition.description));
  const reading = node('span', 'band-reading');
  const current = node('b', '', String(value(band.current)));
  if (previous !== undefined && value(previous) !== value(band.current)) current.classList.add('changed');
  const currentLevel = definition.levels.find((level) => band.current >= level.min && band.current <= level.max) ?? definition.levels.at(-1);
  reading.append(current, node('small', '', currentLevel.word));

  const rail = node('span', 'band-rail');
  const line = node('i', 'rail-line');
  const tail = node('i', 'rail-tail');
  const start = Math.min(band.current, band.baseline);
  const width = Math.abs(band.current - band.baseline);
  tail.style.left = `${start}%`;
  tail.style.width = `${Math.max(width, 0.5)}%`;
  const nature = node('i', 'nature-mark');
  nature.style.left = `${band.baseline}%`;
  nature.title = `Nature ${value(band.baseline)}`;
  const currentMark = node('i', 'current-mark');
  currentMark.style.left = `${band.current}%`;
  rail.append(line, tail, nature, currentMark);

  const delta = node('span', 'band-delta', signed(band.current - band.baseline));
  delta.title = 'Difference from Nature';
  row.append(identity, reading, rail, delta);
  row.addEventListener('click', () => onOpen(definition.id));
  return row;
}

export function renderBands(container, state, onOpen, previousState) {
  const fragment = document.createDocumentFragment();
  for (const definition of state.definitions) {
    fragment.append(renderBand(
      definition,
      state.bands[definition.id],
      onOpen,
      previousState?.bands?.[definition.id]?.current,
    ));
  }
  container.replaceChildren(fragment);
  container.setAttribute('aria-busy', 'false');
}

export function updateBandReadings(container, state) {
  const setText = (element, next) => {
    if (element.textContent !== next) element.textContent = next;
  };
  const setLeft = (element, next) => {
    const css = `${next}%`;
    if (element.style.left !== css) element.style.left = css;
  };
  for (const definition of state.definitions) {
    const row = container.querySelector(`[data-band="${definition.id}"]`);
    if (!row) continue;
    const band = state.bands[definition.id];
    const level = definition.levels.find((item) => band.current >= item.min && band.current <= item.max) ?? definition.levels.at(-1);
    const label = `${definition.name}: Current ${value(band.current)}, Nature ${value(band.baseline)}. Tune feeling.`;
    if (row.getAttribute('aria-label') !== label) row.setAttribute('aria-label', label);
    setText(row.querySelector('.band-reading b'), String(value(band.current)));
    setText(row.querySelector('.band-reading small'), level.word);
    const current = Math.round(band.current * 10) / 10;
    const baseline = Math.round(band.baseline * 10) / 10;
    const start = Math.min(current, baseline);
    const tail = row.querySelector('.rail-tail');
    setLeft(tail, start);
    const width = `${Math.max(Math.abs(current - baseline), 0.5)}%`;
    if (tail.style.width !== width) tail.style.width = width;
    setLeft(row.querySelector('.nature-mark'), baseline);
    setLeft(row.querySelector('.current-mark'), current);
    setText(row.querySelector('.band-delta'), signed(current - baseline));
  }
}

export function renderProfiles(container, state, onApply) {
  const fragment = document.createDocumentFragment();
  for (const [id, profile] of Object.entries(state.profiles)) {
    const button = node('button', `profile-option${state.profileId === id ? ' selected' : ''}`);
    button.type = 'button';
    button.setAttribute('role', 'listitem');
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
