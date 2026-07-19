import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BANDS,
  EMBODIED_FEELING_FRAME,
  MAX_CAPSULE_UTF8_BYTES,
  MODEL_REACTION_CAUSES,
  NATURE_PROFILES,
  REACTION_CAUSES,
  applyFeelingChanges,
  buildFeelingCapsule,
  createDefaultBands,
  decayValue,
  levelForValue,
  materializeBands,
  normalizeRangeOverrides,
  parseAppraisal,
} from '../plugins/viventium-feelings/runtime/kernel.mjs';

test('defines the exact nine bands, defaults, half-lives, and five causal levels', () => {
  assert.deepEqual(BANDS.map((band) => band.id), [
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
  assert.deepEqual(BANDS.map((band) => [band.baseline, band.halfLifeMinutes]), [
    [56, 240],
    [58, 360],
    [62, 480],
    [66, 45],
    [68, 20],
    [74, 1440],
    [52, 480],
    [55, 180],
    [48, 90],
  ]);
  assert.ok(BANDS.every((band) => band.levels.length === 5));
  assert.equal(BANDS.flatMap((band) => band.levels).length, 45);
  assert.deepEqual(BANDS[0].levels.map(({ min, max }) => [min, max]), [
    [0, 19],
    [20, 39],
    [40, 59],
    [60, 79],
    [80, 100],
  ]);
});

test('decays Current lazily toward Nature and treats backward time as zero', () => {
  assert.equal(decayValue({ stored: 100, baseline: 50, elapsedMinutes: 60, halfLifeMinutes: 60 }), 75);
  assert.equal(decayValue({ stored: 100, baseline: 50, elapsedMinutes: -60, halfLifeMinutes: 60 }), 100);
  assert.equal(decayValue({ stored: 150, baseline: -5, elapsedMinutes: 0, halfLifeMinutes: 60 }), 100);
});

test('materializes each band with its own half-life', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  const stored = createDefaultBands(new Date('2026-07-18T11:00:00.000Z'));
  stored.energy.current = 100;
  stored.energy.baseline = 50;
  stored.energy.halfLifeMinutes = 60;
  stored.play.current = 0;
  stored.play.baseline = 100;
  stored.play.halfLifeMinutes = 120;
  const materialized = materializeBands(stored, now);
  assert.equal(materialized.energy.current, 75);
  assert.ok(Math.abs(materialized.play.current - 29.289321881345245) < 1e-9);
});

test('off and all-bands-disabled states produce no capsule', () => {
  const bands = createDefaultBands(new Date(0));
  assert.equal(buildFeelingCapsule({ enabled: false, bands }), '');
  for (const band of Object.values(bands)) band.enabled = false;
  assert.equal(buildFeelingCapsule({ enabled: true, bands }), '');
});

test('capsule uses the exact embodied frame, causal rows, and only the active override', () => {
  const bands = createDefaultBands(new Date(0));
  bands.play.current = 87;
  const capsule = buildFeelingCapsule({
    enabled: true,
    bands,
    rangePromptOverrides: {
      play: {
        level_0: 'Inactive private addition.',
        level_4: 'Look for one genuinely ridiculous turn.',
      },
    },
  });
  assert.ok(capsule.startsWith(`<viventium_feeling_state>\n${EMBODIED_FEELING_FRAME}\n`));
  assert.ok(capsule.includes('play: I cannot keep a straight face;'));
  assert.ok(capsule.includes('Look for one genuinely ridiculous turn.'));
  assert.ok(!capsule.includes('Inactive private addition.'));
  assert.ok(!capsule.includes('87'));
  assert.ok(!capsule.includes('Inner state'));
  assert.equal((capsule.match(/<viventium_feeling_state>/gu) ?? []).length, 1);
});

test('capsule preflight uses a conservative UTF-8 budget for Codex hook context', () => {
  const bands = createDefaultBands(new Date(0));
  const ordinary = buildFeelingCapsule({ enabled: true, bands });
  assert.ok(Buffer.byteLength(ordinary, 'utf8') < MAX_CAPSULE_UTF8_BYTES);
  assert.throws(() => buildFeelingCapsule({
    enabled: true,
    bands,
    rangePromptOverrides: {
      mood: { level_2: '🧠'.repeat(600) },
    },
  }), /capsule_limit/u);
});

test('range overrides are sparse, bounded, normalized, and reject implicit erase', () => {
  assert.deepEqual(normalizeRangeOverrides({ play: { level_4: '  keep   it odd  ' } }), {
    play: { level_4: 'keep it odd' },
  });
  assert.throws(() => normalizeRangeOverrides({ play: { level_4: '   ' } }, { strict: true }), /range_override_invalid/u);
  assert.throws(() => normalizeRangeOverrides({ play: { level_4: 'x'.repeat(1201) } }, { strict: true }), /range_override_invalid/u);
});

test('level lookup clamps endpoints into stable ranges', () => {
  assert.equal(levelForValue('mood', -10).id, 'level_0');
  assert.equal(levelForValue('mood', 19.999).id, 'level_0');
  assert.equal(levelForValue('mood', 20).id, 'level_1');
  assert.equal(levelForValue('mood', 1000).id, 'level_4');
});

test('appraisal parser accepts only closed unique typed operations and one display-only line', () => {
  const parsed = parseAppraisal(JSON.stringify({
    changes: [
      { band: 'mood', direction: 'up', strength: 'clear', cause: 'praise' },
      { band: 'play', direction: 'up', strength: 'strong', cause: 'playful_exchange' },
    ],
    innerState: 'I feel the moment lifting and want to play with it.',
  }));
  assert.equal(parsed.changes.length, 2);
  assert.throws(() => parseAppraisal(JSON.stringify({
    changes: [
      { band: 'mood', direction: 'up', strength: 'clear', cause: 'praise' },
      { band: 'mood', direction: 'down', strength: 'slight', cause: 'loss' },
    ],
    innerState: 'I feel split.',
  })), /appraisal_invalid/u);
  assert.throws(() => parseAppraisal(JSON.stringify({ changes: [], innerState: 'line one\nline two' })), /appraisal_invalid/u);
  assert.equal(MODEL_REACTION_CAUSES.length, 14);
  assert.equal(REACTION_CAUSES.length, 16);
});

test('typed strengths apply deterministic 3, 8, and 15 deltas without moving Nature', () => {
  const bands = createDefaultBands(new Date(0));
  const beforeNature = Object.fromEntries(Object.entries(bands).map(([id, band]) => [id, band.baseline]));
  const result = applyFeelingChanges({
    bands,
    changes: [
      { band: 'energy', direction: 'up', strength: 'slight', cause: 'progress' },
      { band: 'mood', direction: 'down', strength: 'clear', cause: 'setback' },
      { band: 'play', direction: 'up', strength: 'strong', cause: 'playful_exchange' },
    ],
    now: new Date('2026-07-18T12:00:00.000Z'),
  });
  assert.equal(result.bands.energy.current, 59);
  assert.equal(result.bands.mood.current, 50);
  assert.equal(result.bands.play.current, 63);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.bands).map(([id, band]) => [id, band.baseline])),
    beforeNature,
  );
  assert.deepEqual(result.trail.map((entry) => entry.strength), ['slight', 'clear', 'strong']);
});

test('Nature profiles are transparent baseline macros and do not mutate canonical definitions', () => {
  assert.deepEqual(Object.keys(NATURE_PROFILES), ['grounded', 'candid', 'warm', 'curious']);
  assert.equal(NATURE_PROFILES.grounded.values.energy, 56);
  assert.equal(NATURE_PROFILES.warm.values.care > NATURE_PROFILES.grounded.values.care, true);
  assert.equal(NATURE_PROFILES.curious.values.curiosity > NATURE_PROFILES.grounded.values.curiosity, true);
  assert.equal(BANDS.find((band) => band.id === 'care').baseline, 74);
});
