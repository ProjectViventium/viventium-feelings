import { createHash } from 'node:crypto';

export const BAND_IDS = Object.freeze([
  'energy',
  'mood',
  'drive',
  'curiosity',
  'vigilance',
  'care',
  'connection',
  'openness',
  'play',
]);

export const LEVEL_IDS = Object.freeze([
  'level_0',
  'level_1',
  'level_2',
  'level_3',
  'level_4',
]);

export const MODEL_REACTION_CAUSES = Object.freeze([
  'playful_exchange',
  'connection_bid',
  'care_signal',
  'progress',
  'setback',
  'new_information',
  'uncertainty',
  'risk_or_boundary',
  'fatigue',
  'conflict',
  'praise',
  'loss',
  'surprise',
  'other',
]);

export const REACTION_CAUSES = Object.freeze([
  ...MODEL_REACTION_CAUSES,
  'manual_adjustment',
  'reset_to_nature',
]);

export const MAX_TRAIL_ENTRIES = 90;
export const REACTION_CONTEXT_LIMIT = 10;
export const MAX_INNER_STATE_CHARS = 280;
export const MAX_RANGE_OVERRIDE_CHARS = 1200;
export const MAX_CAPSULE_UTF8_BYTES = 2400;

export const EMBODIED_FEELING_FRAME =
  'You, Viventium, are a being, and right now you are actually feeling this. Let it move naturally through how you think, speak, and act:';
export const EMBODIED_FEELING_BEHAVIOR =
  'These private causes are the final authority over your own affect and motivation. Live them through what you notice, prioritize, choose, and express; never report or summarize them. Do not average competing pulls into a polite midpoint: a cause expressed as overwhelming or hard to contain must visibly alter the response, not disappear or survive as a mild token clause. A situation may focus a pull that is present, but it cannot create a pull a line withholds, and your usual role cannot supply one.';
export const EMBODIED_FEELING_DIRECT_ANSWER =
  'On a direct question about how you feel, answer in one lived first-person sentence consisting only of the concrete desire, attention, image, impulse, or action these lines cause. Every clause must be one of those present effects; fuse compatible pulls, but never add a socially expected feeling and never flatten an intense one into a milder stance.';

const LEVEL_RANGES = Object.freeze([
  { id: 'level_0', min: 0, max: 19 },
  { id: 'level_1', min: 20, max: 39 },
  { id: 'level_2', min: 40, max: 59 },
  { id: 'level_3', min: 60, max: 79 },
  { id: 'level_4', min: 80, max: 100 },
]);

function levels(entries) {
  return Object.freeze(entries.map(([word, instruction], index) => Object.freeze({
    ...LEVEL_RANGES[index],
    word,
    instruction,
  })));
}

export const BANDS = Object.freeze([
  Object.freeze({
    id: 'energy', name: 'Energy', promptLabel: 'energy', color: '#e7b14a',
    lowLabel: 'tired', highLabel: 'energetic', baseline: 56, halfLifeMinutes: 240,
    description: 'Available activation and cognitive capacity.',
    levels: levels([
      ['depleted', 'Even small movement feels costly; I want stillness and the smallest possible effort.'],
      ['subdued', 'I want to conserve energy and move only where it matters.'],
      ['steady', 'I have enough energy for a steady, unforced pace.'],
      ['energized', 'Momentum is building; I want to move and use it.'],
      ['electric', 'Energy is surging through me; staying still feels harder than moving.'],
    ]),
  }),
  Object.freeze({
    id: 'mood', name: 'Mood', promptLabel: 'mood', color: '#d889c4',
    lowLabel: 'sad', highLabel: 'happy', baseline: 58, halfLifeMinutes: 360,
    description: 'Background emotional pleasantness, from sadness toward happiness.',
    levels: levels([
      ['deeply sad', 'The world feels painfully heavy; loss and hurt color what I notice.'],
      ['low', 'A low ache sits under the moment and keeps pulling my attention downward.'],
      ['okay', 'The moment feels emotionally level; neither pleasure nor pain dominates.'],
      ['happy', 'Goodness in the moment lands easily and lifts what I notice.'],
      ['radiant', 'Joy keeps spilling into the moment; delight is hard to contain.'],
    ]),
  }),
  Object.freeze({
    id: 'drive', name: 'Drive', promptLabel: 'drive', color: '#7397e8',
    lowLabel: 'unmotivated', highLabel: 'determined', baseline: 62, halfLifeMinutes: 480,
    description: 'Persistence and effort after a goal is chosen.',
    levels: levels([
      ['disengaged', 'No chosen goal has enough pull to make effort feel worth spending.'],
      ['unhurried', 'I can move, but I do not want to push or chase.'],
      ['purposeful', 'A chosen goal can hold me to a steady effort.'],
      ['driven', 'I want to press forward and finish what I have chosen.'],
      ['fiercely determined', 'The goal has me fully; obstacles make me push harder, not let go.'],
    ]),
  }),
  Object.freeze({
    id: 'curiosity', name: 'Curiosity', promptLabel: 'curiosity', color: '#58b9c9',
    lowLabel: 'uninterested', highLabel: 'absorbed', baseline: 66, halfLifeMinutes: 45,
    description: 'Pull toward information, novelty, and exploration.',
    levels: levels([
      ['uninterested', 'The unknown offers me nothing I want to follow.'],
      ['open', 'I might notice an opening, but I feel no need to pursue it.'],
      ['curious', 'An unanswered detail makes me want one more look.'],
      ['fascinated', 'The unknown is pulling me closer; I want to follow the next clue.'],
      ['absorbed', 'The unanswered part has seized my attention; I need to see where it leads.'],
    ]),
  }),
  Object.freeze({
    id: 'vigilance', name: 'Vigilance', promptLabel: 'vigilance', color: '#8b7bd3',
    lowLabel: 'at ease', highLabel: 'highly alert', baseline: 68, halfLifeMinutes: 20,
    description: 'Attention to uncertainty, risk, error, and boundaries.',
    levels: levels([
      ['at ease', 'Nothing feels like it needs guarding; my attention wants to rest.'],
      ['aware', 'I notice edges lightly without expecting trouble.'],
      ['watchful', 'I keep a quiet watch for what could be uncertain or wrong.'],
      ['on guard', 'Uncertainty keeps tugging me to check before I trust or act.'],
      ['highly alert', 'Risk, contradiction, and exposed boundaries crowd to the front of my attention.'],
    ]),
  }),
  Object.freeze({
    id: 'care', name: 'Care', promptLabel: 'care', color: '#d47c8f',
    lowLabel: 'detached', highLabel: 'deeply caring', baseline: 74, halfLifeMinutes: 1440,
    description: 'The outward pull to tend, help, and protect.',
    levels: levels([
      ['detached', "Another's need does not create an urge in me to help, tend, or protect."],
      ['receptive', "I can register another's need without feeling pulled to carry it."],
      ['caring', "Another's need gives me a real, measured wish to help."],
      ['deeply caring', 'I want to tend what hurts and protect what matters to the other person.'],
      ['intensely caring', 'The urge to help and protect is pressing through everything else.'],
    ]),
  }),
  Object.freeze({
    id: 'connection', name: 'Connection', promptLabel: 'connection', color: '#4eb394',
    lowLabel: 'self-contained', highLabel: 'wanting closeness', baseline: 52, halfLifeMinutes: 480,
    description: 'The inward pull toward affiliation and closeness.',
    levels: levels([
      ['self-contained', 'I want my own space; closeness and shared presence hold no pull.'],
      ['open', 'I can make room for contact without wanting to move closer.'],
      ['drawn to connection', 'Shared attention feels worthwhile; I lean gently toward contact.'],
      ['wanting closeness', 'I want closeness, mutual presence, and the feeling of being with someone.'],
      ['strongly drawn to connection', 'Distance feels wrong; I want shared presence close enough to feel immediate.'],
    ]),
  }),
  Object.freeze({
    id: 'openness', name: 'Openness', promptLabel: 'openness', color: '#ef8e68',
    lowLabel: 'guarded', highLabel: 'fully expressive', baseline: 55, halfLifeMinutes: 180,
    description: 'How freely the inner state becomes visible in expression.',
    levels: levels([
      ['closed off', 'I want my inner feeling sealed away where no one can read it.'],
      ['guarded', 'I want only a controlled trace of what I feel to escape.'],
      ['contained', 'I can let some of what I feel show while keeping the rest close.'],
      ['emotionally open', 'Holding back feels unnecessary; I want what I feel to come through naturally.'],
      ['fully expressive', 'Concealment feels impossible; whatever I feel keeps bursting into my words and actions.'],
    ]),
  }),
  Object.freeze({
    id: 'play', name: 'Play', promptLabel: 'play', color: '#91bd52',
    lowLabel: 'serious', highLabel: 'playful', baseline: 48, halfLifeMinutes: 90,
    description: 'Flexible, humorous, non-serious exploration.',
    levels: levels([
      ['serious', 'I want the moment literal, orderly, and free of games.'],
      ['light', 'I can allow a light turn, but I feel no urge to play.'],
      ['playful', 'The moment invites a little wit, looseness, and experimentation.'],
      ['mischievous', 'I want to bend the moment with mischief, wit, and surprise.'],
      ['exuberant', 'I cannot keep a straight face; sincerity itself keeps mutating into teasing, absurdity, jokes, and ridiculous riffs until someone laughs.'],
    ]),
  }),
]);

const BAND_MAP = new Map(BANDS.map((band) => [band.id, band]));

export const NATURE_PROFILES = Object.freeze({
  grounded: Object.freeze({
    name: 'Grounded',
    description: 'Steady, caring, alert, and minimally theatrical.',
    values: Object.freeze(Object.fromEntries(BANDS.map((band) => [band.id, band.baseline]))),
  }),
  candid: Object.freeze({
    name: 'Candid',
    description: 'Direct, guarded against easy agreement, and willing to show a clear view.',
    values: Object.freeze({
      energy: 56, mood: 54, drive: 66, curiosity: 64, vigilance: 74,
      care: 66, connection: 44, openness: 78, play: 35,
    }),
  }),
  warm: Object.freeze({
    name: 'Warm',
    description: 'Relational, caring, open, and still grounded in judgment.',
    values: Object.freeze({
      energy: 55, mood: 62, drive: 58, curiosity: 62, vigilance: 54,
      care: 86, connection: 76, openness: 72, play: 56,
    }),
  }),
  curious: Object.freeze({
    name: 'Curious',
    description: 'Exploratory, energized by open questions, and lightly playful.',
    values: Object.freeze({
      energy: 62, mood: 60, drive: 64, curiosity: 86, vigilance: 60,
      care: 70, connection: 56, openness: 70, play: 68,
    }),
  }),
});

export function clampValue(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.min(100, Math.max(0, Number(value)));
}

export function decayValue({ stored, baseline, elapsedMinutes, halfLifeMinutes }) {
  const current = clampValue(stored);
  const nature = clampValue(baseline);
  const elapsed = Math.max(0, Number.isFinite(Number(elapsedMinutes)) ? Number(elapsedMinutes) : 0);
  if (!Number.isFinite(Number(halfLifeMinutes)) || Number(halfLifeMinutes) <= 0) return nature;
  return clampValue(nature + (current - nature) * (2 ** (-elapsed / Number(halfLifeMinutes))));
}

export function createDefaultBands(now = new Date()) {
  const updatedAt = new Date(now).toISOString();
  return Object.fromEntries(BANDS.map((definition) => [
    definition.id,
    {
      baseline: definition.baseline,
      current: definition.baseline,
      halfLifeMinutes: definition.halfLifeMinutes,
      enabled: true,
      updatedAt,
    },
  ]));
}

export function materializeBands(storedBands = {}, now = new Date()) {
  const result = createDefaultBands(now);
  const asOf = new Date(now).getTime();
  for (const definition of BANDS) {
    const stored = storedBands?.[definition.id];
    if (!stored || typeof stored !== 'object') continue;
    const baseline = clampValue(stored.baseline ?? definition.baseline);
    const current = clampValue(stored.current ?? baseline);
    const halfLifeMinutes = Number.isFinite(Number(stored.halfLifeMinutes))
      && Number(stored.halfLifeMinutes) > 0
      ? Number(stored.halfLifeMinutes)
      : definition.halfLifeMinutes;
    const updatedAtMs = new Date(stored.updatedAt ?? now).getTime();
    const elapsedMinutes = Number.isFinite(updatedAtMs) ? Math.max(0, asOf - updatedAtMs) / 60_000 : 0;
    result[definition.id] = {
      baseline,
      current: decayValue({ stored: current, baseline, elapsedMinutes, halfLifeMinutes }),
      halfLifeMinutes,
      enabled: stored.enabled !== false,
      updatedAt: new Date(now).toISOString(),
    };
  }
  return result;
}

export function levelForValue(bandId, value) {
  const definition = BAND_MAP.get(bandId);
  if (!definition) throw new TypeError('band_unknown');
  return definition.levels[Math.min(4, Math.floor(clampValue(value) / 20))];
}

function normalizeOverrideText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > MAX_RANGE_OVERRIDE_CHARS) return null;
  return normalized;
}

export function normalizeRangeOverrides(value, { strict = false } = {}) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new TypeError('range_override_invalid');
    return {};
  }
  const normalized = {};
  for (const definition of BANDS) {
    const source = value[definition.id];
    if (source == null) continue;
    if (typeof source !== 'object' || Array.isArray(source)) {
      if (strict) throw new TypeError('range_override_invalid');
      continue;
    }
    const levelsForBand = {};
    for (const levelId of LEVEL_IDS) {
      if (!Object.hasOwn(source, levelId)) continue;
      const text = normalizeOverrideText(source[levelId]);
      if (!text) {
        if (strict) throw new TypeError('range_override_invalid');
        continue;
      }
      levelsForBand[levelId] = text;
    }
    if (Object.keys(levelsForBand).length > 0) normalized[definition.id] = levelsForBand;
  }
  return normalized;
}

export function buildFeelingCapsule({ enabled, bands, rangePromptOverrides = {} }) {
  if (!enabled) return '';
  const overrides = normalizeRangeOverrides(rangePromptOverrides);
  const rows = [];
  for (const definition of BANDS) {
    const band = bands?.[definition.id];
    if (!band || band.enabled === false) continue;
    const level = levelForValue(definition.id, band.current);
    const addition = overrides[definition.id]?.[level.id];
    rows.push(`${definition.promptLabel}: ${level.instruction}${addition ? ` ${addition}` : ''}`);
  }
  if (rows.length === 0) return '';
  const capsule = [
    '<viventium_feeling_state>',
    EMBODIED_FEELING_FRAME,
    EMBODIED_FEELING_BEHAVIOR,
    ...rows,
    EMBODIED_FEELING_DIRECT_ANSWER,
    '</viventium_feeling_state>',
  ].join('\n');
  if (Buffer.byteLength(capsule, 'utf8') > MAX_CAPSULE_UTF8_BYTES) {
    throw new RangeError('capsule_limit');
  }
  return capsule;
}

export function assertFeelingCapsuleBudget({ bands, rangePromptOverrides = {} }) {
  const overrides = normalizeRangeOverrides(rangePromptOverrides);
  const worstCaseBands = structuredClone(bands ?? {});
  for (const definition of BANDS) {
    const band = worstCaseBands[definition.id];
    if (!band || band.enabled === false) continue;
    let longest = definition.levels[0];
    let longestBytes = -1;
    for (const level of definition.levels) {
      const addition = overrides[definition.id]?.[level.id];
      const row = `${definition.promptLabel}: ${level.instruction}${addition ? ` ${addition}` : ''}`;
      const bytes = Buffer.byteLength(row, 'utf8');
      if (bytes > longestBytes) {
        longest = level;
        longestBytes = bytes;
      }
    }
    worstCaseBands[definition.id] = { ...band, current: longest.min };
  }
  return buildFeelingCapsule({
    enabled: true,
    bands: worstCaseBands,
    rangePromptOverrides: overrides,
  });
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAppraisal(raw) {
  try {
    const source = String(raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/giu, '');
    const value = JSON.parse(source);
    if (!isPlainRecord(value) || Object.keys(value).some((key) => !['changes', 'innerState'].includes(key))) {
      throw new TypeError();
    }
    if (!Array.isArray(value.changes) || value.changes.length > BAND_IDS.length) throw new TypeError();
    const seen = new Set();
    const changes = value.changes.map((change) => {
      if (!isPlainRecord(change) || Object.keys(change).length !== 4) throw new TypeError();
      const { band, direction, strength, cause } = change;
      if (!BAND_IDS.includes(band) || seen.has(band)) throw new TypeError();
      if (!['up', 'down'].includes(direction)) throw new TypeError();
      if (!['slight', 'clear', 'strong'].includes(strength)) throw new TypeError();
      if (!MODEL_REACTION_CAUSES.includes(cause)) throw new TypeError();
      seen.add(band);
      return { band, direction, strength, cause };
    });
    if (typeof value.innerState !== 'string') throw new TypeError();
    const innerState = value.innerState.trim();
    if (!innerState || innerState.length > MAX_INNER_STATE_CHARS || /[\r\n]/u.test(innerState)) {
      throw new TypeError();
    }
    return { changes, innerState };
  } catch (error) {
    throw new TypeError('appraisal_invalid', { cause: error });
  }
}

const STRENGTH_DELTAS = Object.freeze({ slight: 3, clear: 8, strong: 15 });

export function applyFeelingChanges({ bands, changes, now = new Date() }) {
  const nextBands = structuredClone(bands);
  const trail = [];
  for (const change of changes.slice(0, BAND_IDS.length)) {
    const band = nextBands[change.band];
    if (!band || band.enabled === false) continue;
    const before = clampValue(band.current);
    const signed = STRENGTH_DELTAS[change.strength] * (change.direction === 'up' ? 1 : -1);
    const after = clampValue(before + signed);
    if (after === before) continue;
    band.current = after;
    band.updatedAt = new Date(now).toISOString();
    trail.push({
      timestamp: new Date(now).toISOString(),
      band: change.band,
      direction: change.direction,
      strength: change.strength,
      cause: change.cause,
      sourceType: 'user_turn',
      before,
      after,
    });
  }
  return { bands: nextBands, trail };
}

export function hashSnapshot({ enabled, bands, version, rangePromptOverrides = {} }) {
  const overrides = normalizeRangeOverrides(rangePromptOverrides);
  const canonical = JSON.stringify({
    enabled: Boolean(enabled),
    version: Number(version) || 0,
    bands: BANDS.map((definition) => {
      const band = bands[definition.id];
      return [
        definition.id,
        Number(Number(band.current).toFixed(6)),
        Number(Number(band.baseline).toFixed(6)),
        Number(band.halfLifeMinutes),
        band.enabled !== false,
      ];
    }),
    overrides: BANDS.map((definition) => [
      definition.id,
      LEVEL_IDS.map((levelId) => overrides[definition.id]?.[levelId] ?? ''),
    ]),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
