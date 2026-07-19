import { randomBytes } from 'node:crypto';
import {
  access,
  appendFile,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BAND_IDS,
  BANDS,
  LEVEL_IDS,
  MAX_TRAIL_ENTRIES,
  NATURE_PROFILES,
  REACTION_CAUSES,
  applyFeelingChanges,
  assertFeelingCapsuleBudget,
  buildFeelingCapsule,
  clampValue,
  createDefaultBands,
  hashSnapshot,
  levelForValue,
  materializeBands,
  normalizeRangeOverrides,
  parseAppraisal,
} from './kernel.mjs';
import { withOwnedDirectoryLock } from './owned-directory-lock.mjs';

const SCHEMA_VERSION = 1;
const STATE_FILE = 'state.json';
const DASHBOARD_PREFERENCES_FILE = 'dashboard-preferences.json';
const LOCK_DIR = '.state.lock';
const LOCK_OWNER = 'owner.json';
const DEFAULT_LOCK_WAIT_MS = 4_000;
const STALE_LOCK_MS = 30_000;
const MAX_AUDIT_BYTES = 1_000_000;
const DEFAULT_REACTION_INSTRUCTION =
  'React to what genuinely moves Viventium. Let each change match how much the moment matters. Move only the feelings the moment actually touches, and leave nature unchanged.';
const LEGACY_DEFAULT_REACTION_INSTRUCTIONS = new Set([
  'React to what genuinely moves Viventium. Prefer small natural changes. Move only the feelings the moment actually touches, and leave nature unchanged.',
]);

export class ConflictError extends Error {
  constructor() {
    super('version_conflict');
    this.code = 'version_conflict';
  }
}

export class ValidationError extends Error {
  constructor(code = 'validation_error') {
    super(code);
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strictFiniteNumber(value, code = 'number_invalid') {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(code);
  return value;
}

function strictRangeOverrides(value) {
  try {
    return normalizeRangeOverrides(value, { strict: true });
  } catch {
    throw new ValidationError('range_override_invalid');
  }
}

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ValidationError('date_invalid');
  return date.toISOString();
}

function nullableIso(value) {
  return value == null ? null : iso(value);
}

function nullableBoundedString(value, maxLength = 120) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ValidationError('state_invalid');
  const text = value.trim();
  if (!text || text.length > maxLength || /[\r\n]/u.test(text)) {
    throw new ValidationError('state_invalid');
  }
  return text;
}

function defaultHealth() {
  return {
    status: 'never',
    lastStartedAt: null,
    lastCompletedAt: null,
    lastDurationMs: null,
    lastErrorClass: null,
    lastSkipReason: null,
    requestedHost: null,
    lastUsedHost: null,
    lastUsedModel: null,
    lastFallbackUsed: null,
  };
}

function createDefaultState(now = new Date()) {
  const timestamp = iso(now);
  return {
    schemaVersion: SCHEMA_VERSION,
    version: 0,
    controlEpoch: 0,
    enabled: false,
    profileId: 'grounded',
    bands: createDefaultBands(now),
    rangePromptOverrides: {},
    reactionInstruction: DEFAULT_REACTION_INSTRUCTION,
    reactionActivationMode: 'always',
    innerState: null,
    trail: [],
    reactionHealth: defaultHealth(),
    processedStimulusKeys: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateBandState(value, bandId) {
  if (!isRecord(value)) throw new ValidationError('state_invalid');
  const { baseline, current, halfLifeMinutes } = value;
  if (!Number.isFinite(baseline) || baseline < 0 || baseline > 100) throw new ValidationError('state_invalid');
  if (!Number.isFinite(current) || current < 0 || current > 100) throw new ValidationError('state_invalid');
  if (!Number.isFinite(halfLifeMinutes) || halfLifeMinutes < 1 || halfLifeMinutes > 525_600) {
    throw new ValidationError('state_invalid');
  }
  if (typeof value.enabled !== 'boolean') throw new ValidationError('state_invalid');
  return {
    baseline,
    current,
    halfLifeMinutes,
    enabled: value.enabled,
    updatedAt: iso(value.updatedAt),
    id: bandId,
  };
}

function validateInnerState(value) {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.text !== 'string') throw new ValidationError('state_invalid');
  const text = value.text.trim();
  if (!text || text.length > 280 || /[\r\n]/u.test(text)) throw new ValidationError('state_invalid');
  return { text, generatedAt: iso(value.generatedAt) };
}

function validateTrail(value) {
  if (!Array.isArray(value)) throw new ValidationError('state_invalid');
  return value.slice(-MAX_TRAIL_ENTRIES).map((entry) => {
    if (!isRecord(entry)) throw new ValidationError('state_invalid');
    if (!BAND_IDS.includes(entry.band)) throw new ValidationError('state_invalid');
    if (!['up', 'down'].includes(entry.direction)) throw new ValidationError('state_invalid');
    if (!['slight', 'clear', 'strong'].includes(entry.strength)) throw new ValidationError('state_invalid');
    if (!REACTION_CAUSES.includes(entry.cause)) throw new ValidationError('state_invalid');
    if (!['user_turn', 'manual', 'reset'].includes(entry.sourceType)) throw new ValidationError('state_invalid');
    if (!Number.isFinite(entry.before) || entry.before < 0 || entry.before > 100) {
      throw new ValidationError('state_invalid');
    }
    if (!Number.isFinite(entry.after) || entry.after < 0 || entry.after > 100) {
      throw new ValidationError('state_invalid');
    }
    return {
      timestamp: iso(entry.timestamp),
      band: entry.band,
      direction: entry.direction,
      strength: entry.strength,
      cause: entry.cause,
      sourceType: entry.sourceType,
      before: entry.before,
      after: entry.after,
    };
  });
}

function validateReactionHealth(value) {
  if (value == null) return defaultHealth();
  if (!isRecord(value)) throw new ValidationError('state_invalid');
  const allowed = new Set(Object.keys(defaultHealth()));
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ValidationError('state_invalid');
  if (!['never', 'running', 'healthy', 'degraded', 'skipped'].includes(value.status)) {
    throw new ValidationError('state_invalid');
  }
  const lastDurationMs = value.lastDurationMs == null ? null : value.lastDurationMs;
  if (lastDurationMs !== null && (
    !Number.isFinite(lastDurationMs) || lastDurationMs < 0 || lastDurationMs > 86_400_000
  )) {
    throw new ValidationError('state_invalid');
  }
  if (value.lastFallbackUsed != null && typeof value.lastFallbackUsed !== 'boolean') {
    throw new ValidationError('state_invalid');
  }
  return {
    status: value.status,
    lastStartedAt: nullableIso(value.lastStartedAt),
    lastCompletedAt: nullableIso(value.lastCompletedAt),
    lastDurationMs,
    lastErrorClass: nullableBoundedString(value.lastErrorClass),
    lastSkipReason: nullableBoundedString(value.lastSkipReason),
    requestedHost: nullableBoundedString(value.requestedHost),
    lastUsedHost: nullableBoundedString(value.lastUsedHost),
    lastUsedModel: nullableBoundedString(value.lastUsedModel),
    lastFallbackUsed: value.lastFallbackUsed ?? null,
  };
}

function validateState(value) {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) throw new ValidationError('state_invalid');
  if (!Number.isInteger(value.version) || value.version < 0) throw new ValidationError('state_invalid');
  if (!Number.isInteger(value.controlEpoch) || value.controlEpoch < 0) throw new ValidationError('state_invalid');
  if (typeof value.enabled !== 'boolean') throw new ValidationError('state_invalid');
  if (!isRecord(value.bands)) throw new ValidationError('state_invalid');
  const bands = Object.fromEntries(BAND_IDS.map((bandId) => {
    const band = validateBandState(value.bands[bandId], bandId);
    delete band.id;
    return [bandId, band];
  }));
  const rangePromptOverrides = normalizeRangeOverrides(value.rangePromptOverrides, { strict: true });
  const storedReactionInstruction = String(value.reactionInstruction ?? '').trim();
  const reactionInstruction = LEGACY_DEFAULT_REACTION_INSTRUCTIONS.has(storedReactionInstruction)
    ? DEFAULT_REACTION_INSTRUCTION
    : storedReactionInstruction;
  if (!reactionInstruction || reactionInstruction.length > 4000) throw new ValidationError('state_invalid');
  if (!['always', 'disabled'].includes(value.reactionActivationMode)) throw new ValidationError('state_invalid');
  if (!['grounded', 'candid', 'warm', 'curious', 'custom'].includes(value.profileId)) {
    throw new ValidationError('state_invalid');
  }
  const processedStimulusKeys = Array.isArray(value.processedStimulusKeys)
    ? value.processedStimulusKeys.filter((key) => /^stimulus-[a-f0-9]{24}$/u.test(key)).slice(-100)
    : [];
  const state = {
    schemaVersion: SCHEMA_VERSION,
    version: value.version,
    controlEpoch: value.controlEpoch,
    enabled: value.enabled,
    profileId: value.profileId,
    bands,
    rangePromptOverrides,
    reactionInstruction,
    reactionActivationMode: value.reactionActivationMode,
    innerState: validateInnerState(value.innerState),
    trail: validateTrail(value.trail),
    reactionHealth: validateReactionHealth(value.reactionHealth),
    processedStimulusKeys,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
  return state;
}

function assertCapsuleBudget(state) {
  try {
    assertFeelingCapsuleBudget({
      bands: state.bands,
      rangePromptOverrides: state.rangePromptOverrides,
    });
  } catch (error) {
    if (error instanceof RangeError && error.message === 'capsule_limit') {
      throw new ValidationError('capsule_limit');
    }
    throw error;
  }
}

function strengthForDifference(value) {
  if (value <= 4) return 'slight';
  if (value <= 10) return 'clear';
  return 'strong';
}

function decorate(state, now = new Date()) {
  const bands = materializeBands(state.bands, now);
  let capsule;
  let reactionHealth = state.reactionHealth;
  try {
    capsule = buildFeelingCapsule({
      enabled: state.enabled,
      bands,
      rangePromptOverrides: state.rangePromptOverrides,
    });
  } catch (error) {
    if (!(error instanceof RangeError) || error.message !== 'capsule_limit') throw error;
    capsule = buildFeelingCapsule({ enabled: state.enabled, bands });
    reactionHealth = {
      ...state.reactionHealth,
      status: 'degraded',
      lastErrorClass: 'capsule_limit',
      lastSkipReason: null,
    };
  }
  return {
    ...structuredClone(state),
    reactionHealth,
    asOf: iso(now),
    bands,
    capsule,
    snapshotHash: hashSnapshot({
      enabled: state.enabled,
      bands,
      version: state.version,
      rangePromptOverrides: state.rangePromptOverrides,
    }),
    definitions: BANDS,
    profiles: NATURE_PROFILES,
  };
}

export function resolveHost() {
  if (process.env.VIVENTIUM_FEELINGS_HOST === 'claude') return 'claude';
  if (process.env.VIVENTIUM_FEELINGS_HOST === 'codex') return 'codex';
  if (process.env.CODEX_HOME) return 'codex';
  return process.env.PLUGIN_ROOT || process.env.PLUGIN_DATA ? 'codex' : 'claude';
}

function codexHomeFromInstalledPluginRoot(cwd) {
  const resolved = path.resolve(cwd);
  const segments = resolved.split(path.sep);
  for (let index = segments.length - 5; index >= 0; index -= 1) {
    if (
      segments[index] === 'plugins'
      && segments[index + 1] === 'cache'
      && segments[index + 3] === 'viventium-feelings'
      && segments[index + 4]
    ) {
      const prefix = segments.slice(0, index).join(path.sep) || path.sep;
      return prefix;
    }
  }
  return null;
}

export function resolveStateDir({ cwd = process.cwd() } = {}) {
  const nativeCandidate = process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA;
  const native = nativeCandidate && !/^\$\{[^}]+\}$/u.test(nativeCandidate)
    ? nativeCandidate
    : null;
  if (native) return path.resolve(native);
  const home = process.env.HOME || os.homedir();
  if (resolveHost() === 'codex') {
    const codexHome = process.env.CODEX_HOME
      || codexHomeFromInstalledPluginRoot(cwd)
      || path.join(home, '.codex');
    return path.join(codexHome, 'plugins', 'data', 'viventium-feelings-project-viventium');
  }
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(claudeConfigDir, 'plugins', 'data', 'viventium-feelings-project-viventium');
}

async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  await ensurePrivateDir(dir);
  const temporary = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

async function withLock(dir, operation, waitMs = DEFAULT_LOCK_WAIT_MS) {
  await ensurePrivateDir(dir);
  return withOwnedDirectoryLock({
    parentDir: dir,
    lockName: LOCK_DIR,
    ownerName: LOCK_OWNER,
    staleMs: STALE_LOCK_MS,
    waitMs,
    timeoutCode: 'state_lock_timeout',
    retryDelay: () => 15 + Math.floor(Math.random() * 25),
    operation,
  });
}

async function appendAudit(dir, entry) {
  await ensurePrivateDir(dir);
  const safe = {
    timestamp: new Date().toISOString(),
    event: String(entry.event || 'unknown'),
    status: String(entry.status || 'unknown'),
    errorCode: entry.errorCode ? String(entry.errorCode) : null,
    version: Number.isInteger(entry.version) ? entry.version : null,
  };
  const filePath = path.join(dir, 'audit.jsonl');
  try {
    if ((await stat(filePath)).size >= MAX_AUDIT_BYTES) {
      await rm(`${filePath}.1`, { force: true });
      await rename(filePath, `${filePath}.1`);
      await chmod(`${filePath}.1`, 0o600);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await appendFile(filePath, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

export function createStateStore({ dir = resolveStateDir(), now = () => new Date(), lockWaitMs } = {}) {
  const statePath = path.join(dir, STATE_FILE);
  const dashboardPreferencesPath = path.join(dir, DASHBOARD_PREFERENCES_FILE);

  async function readDashboardPreferences() {
    try {
      const parsed = JSON.parse(await readFile(dashboardPreferencesPath, 'utf8'));
      return { theme: ['system', 'light', 'dark'].includes(parsed?.theme) ? parsed.theme : 'system' };
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { theme: 'system' };
      throw error;
    }
  }

  async function setDashboardPreferences({ theme }) {
    if (!['system', 'light', 'dark'].includes(theme)) throw new ValidationError('theme_invalid');
    return withLock(dir, async () => {
      const preferences = { theme };
      await atomicWriteJson(dashboardPreferencesPath, preferences);
      return preferences;
    }, lockWaitMs);
  }

  async function readPersisted({ recover = true } = {}) {
    try {
      return validateState(JSON.parse(await readFile(statePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (!recover) throw error;
      const recoveryName = path.join(dir, `state.corrupt.${Date.now()}.json`);
      await rename(statePath, recoveryName).catch(() => {});
      await chmod(recoveryName, 0o600).catch(() => {});
      await appendAudit(dir, { event: 'state.recover', status: 'degraded', errorCode: 'state_corrupt' }).catch(() => {});
      return null;
    }
  }

  async function read() {
    const stored = await readPersisted();
    return decorate(stored ?? createDefaultState(now()), now());
  }

  async function mutate({ expectedVersion, control = true, action, auditEvent }) {
    return withLock(dir, async () => {
      const timestamp = now();
      const stored = await readPersisted();
      const base = stored ?? createDefaultState(timestamp);
      if (base.version !== expectedVersion) throw new ConflictError();
      const materialized = { ...base, bands: materializeBands(base.bands, timestamp) };
      const changed = await action(structuredClone(materialized), timestamp);
      changed.schemaVersion = SCHEMA_VERSION;
      changed.version = base.version + 1;
      changed.controlEpoch = base.controlEpoch + (control ? 1 : 0);
      changed.createdAt = base.createdAt;
      changed.updatedAt = iso(timestamp);
      const validated = validateState(changed);
      assertCapsuleBudget(validated);
      const decorated = decorate(validated, timestamp);
      await atomicWriteJson(statePath, validated);
      await appendAudit(dir, {
        event: auditEvent,
        status: 'applied',
        version: validated.version,
      }).catch(() => {});
      return decorated;
    }, lockWaitMs);
  }

  async function setEnabled({ expectedVersion, enabled }) {
    if (typeof enabled !== 'boolean') throw new ValidationError();
    return mutate({
      expectedVersion,
      auditEvent: enabled ? 'state.enable' : 'state.pause',
      action(state) {
        state.enabled = enabled;
        state.innerState = null;
        const resumedStatus = state.reactionHealth.lastErrorClass
          ? 'degraded'
          : (state.reactionHealth.lastCompletedAt ? 'healthy' : 'never');
        state.reactionHealth = {
          ...state.reactionHealth,
          status: enabled && state.reactionHealth.status === 'skipped'
            ? resumedStatus
            : (enabled ? state.reactionHealth.status : 'skipped'),
          lastSkipReason: enabled ? null : 'disabled',
        };
        return state;
      },
    });
  }

  async function updateBand({ expectedVersion, bandId, patch }) {
    if (!BAND_IDS.includes(bandId) || !isRecord(patch)) throw new ValidationError();
    const allowed = new Set([
      'baseline',
      'current',
      'halfLifeMinutes',
      'enabled',
      'reset',
      'rangePromptOverride',
      'rangePromptOverrides',
    ]);
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new ValidationError();
    if (patch.reset !== undefined && typeof patch.reset !== 'boolean') throw new ValidationError('reset_invalid');
    return mutate({
      expectedVersion,
      auditEvent: 'state.band_update',
      action(state, timestamp) {
        const band = { ...state.bands[bandId] };
        if (patch.baseline !== undefined) {
          band.baseline = clampValue(strictFiniteNumber(patch.baseline, 'baseline_invalid'));
        }
        if (patch.halfLifeMinutes !== undefined) {
          const halfLife = strictFiniteNumber(patch.halfLifeMinutes, 'half_life_invalid');
          if (halfLife < 1 || halfLife > 525_600) throw new ValidationError('half_life_invalid');
          band.halfLifeMinutes = halfLife;
        }
        if (patch.enabled !== undefined) {
          if (typeof patch.enabled !== 'boolean') throw new ValidationError();
          band.enabled = patch.enabled;
        }
        const before = band.current;
        if (patch.reset === true) band.current = band.baseline;
        else if (patch.current !== undefined) {
          band.current = clampValue(strictFiniteNumber(patch.current, 'current_invalid'));
        }
        band.updatedAt = iso(timestamp);
        state.bands[bandId] = band;
        if (band.current !== before) {
          state.trail = [...state.trail, {
            timestamp: iso(timestamp),
            band: bandId,
            direction: band.current > before ? 'up' : 'down',
            strength: strengthForDifference(Math.abs(band.current - before)),
            cause: patch.reset === true ? 'reset_to_nature' : 'manual_adjustment',
            sourceType: patch.reset === true ? 'reset' : 'manual',
            before,
            after: band.current,
          }].slice(-MAX_TRAIL_ENTRIES);
        }
        if (patch.rangePromptOverride !== undefined) {
          const range = patch.rangePromptOverride;
          if (!isRecord(range) || !LEVEL_IDS.includes(range.levelId)) throw new ValidationError();
          const next = structuredClone(state.rangePromptOverrides);
          if (range.instruction === null) {
            delete next[bandId]?.[range.levelId];
            if (Object.keys(next[bandId] ?? {}).length === 0) delete next[bandId];
          } else {
            const normalized = strictRangeOverrides({
              [bandId]: { [range.levelId]: range.instruction },
            });
            next[bandId] = { ...(next[bandId] ?? {}), ...normalized[bandId] };
          }
          state.rangePromptOverrides = next;
        }
        if (patch.rangePromptOverrides !== undefined) {
          if (!isRecord(patch.rangePromptOverrides)) throw new ValidationError();
          if (Object.keys(patch.rangePromptOverrides).some((levelId) => !LEVEL_IDS.includes(levelId))) {
            throw new ValidationError();
          }
          const next = structuredClone(state.rangePromptOverrides);
          const bandOverrides = { ...(next[bandId] ?? {}) };
          for (const [levelId, instruction] of Object.entries(patch.rangePromptOverrides)) {
            if (instruction === null) {
              delete bandOverrides[levelId];
              continue;
            }
            const normalized = strictRangeOverrides({
              [bandId]: { [levelId]: instruction },
            });
            bandOverrides[levelId] = normalized[bandId][levelId];
          }
          if (Object.keys(bandOverrides).length === 0) delete next[bandId];
          else next[bandId] = bandOverrides;
          state.rangePromptOverrides = next;
        }
        state.profileId = 'custom';
        state.innerState = null;
        return state;
      },
    });
  }

  async function applyProfile({ expectedVersion, profileId, resetCurrent = true }) {
    const profile = NATURE_PROFILES[profileId];
    if (!profile) throw new ValidationError('profile_invalid');
    if (typeof resetCurrent !== 'boolean') throw new ValidationError('reset_current_invalid');
    return mutate({
      expectedVersion,
      auditEvent: 'state.profile_update',
      action(state, timestamp) {
        for (const bandId of BAND_IDS) {
          state.bands[bandId].baseline = profile.values[bandId];
          if (resetCurrent) state.bands[bandId].current = profile.values[bandId];
          state.bands[bandId].updatedAt = iso(timestamp);
        }
        state.profileId = profileId;
        state.innerState = null;
        return state;
      },
    });
  }

  async function updateProfile({ expectedVersion, patch }) {
    if (!isRecord(patch)) throw new ValidationError();
    const allowed = new Set(['reactionInstruction', 'reactionActivationMode']);
    if (Object.keys(patch).some((key) => !allowed.has(key))) throw new ValidationError();
    return mutate({
      expectedVersion,
      auditEvent: 'state.profile_settings',
      action(state) {
        if (patch.reactionInstruction !== undefined) {
          const instruction = String(patch.reactionInstruction).trim();
          if (!instruction || instruction.length > 4000) throw new ValidationError();
          state.reactionInstruction = instruction;
        }
        if (patch.reactionActivationMode !== undefined) {
          if (!['always', 'disabled'].includes(patch.reactionActivationMode)) throw new ValidationError();
          state.reactionActivationMode = patch.reactionActivationMode;
        }
        state.innerState = null;
        return state;
      },
    });
  }

  async function reset({ expectedVersion }) {
    return mutate({
      expectedVersion,
      auditEvent: 'state.reset',
      action(state, timestamp) {
        for (const bandId of BAND_IDS) {
          const band = state.bands[bandId];
          const before = band.current;
          band.current = band.baseline;
          band.updatedAt = iso(timestamp);
          if (before !== band.current) {
            state.trail.push({
              timestamp: iso(timestamp), band: bandId,
              direction: band.current > before ? 'up' : 'down',
              strength: strengthForDifference(Math.abs(band.current - before)),
              cause: 'reset_to_nature', sourceType: 'reset', before, after: band.current,
            });
          }
        }
        state.trail = state.trail.slice(-MAX_TRAIL_ENTRIES);
        state.innerState = null;
        return state;
      },
    });
  }

  async function commitReaction({
    eventId,
    baseVersion,
    baseControlEpoch,
    changes,
    innerState,
    health = {},
  }) {
    if (!/^stimulus-[a-f0-9]{24}$/u.test(eventId)) throw new ValidationError('event_invalid');
    const parsed = parseAppraisal(JSON.stringify({ changes, innerState }));
    return withLock(dir, async () => {
      const timestamp = now();
      const stored = await readPersisted();
      if (!stored) return { status: 'cancelled_by_control', state: decorate(createDefaultState(timestamp), timestamp) };
      if (stored.processedStimulusKeys.includes(eventId)) {
        return { status: 'duplicate', state: decorate(stored, timestamp), rebased: false };
      }
      if (!stored.enabled || stored.reactionActivationMode === 'disabled' || stored.controlEpoch !== baseControlEpoch) {
        await appendAudit(dir, { event: 'reaction.commit', status: 'cancelled_by_control', version: stored.version }).catch(() => {});
        return { status: 'cancelled_by_control', state: decorate(stored, timestamp), rebased: stored.version !== baseVersion };
      }
      const materialized = { ...stored, bands: materializeBands(stored.bands, timestamp) };
      const applied = applyFeelingChanges({ bands: materialized.bands, changes: parsed.changes, now: timestamp });
      const rebased = stored.version !== baseVersion;
      const next = {
        ...materialized,
        version: stored.version + 1,
        bands: applied.bands,
        trail: [...stored.trail, ...applied.trail].slice(-MAX_TRAIL_ENTRIES),
        innerState: rebased ? stored.innerState : { text: parsed.innerState, generatedAt: iso(timestamp) },
        processedStimulusKeys: [...stored.processedStimulusKeys, eventId].slice(-100),
        reactionHealth: {
          ...stored.reactionHealth,
          status: 'healthy',
          lastCompletedAt: iso(timestamp),
          lastDurationMs: Number.isFinite(Number(health.durationMs)) ? Number(health.durationMs) : null,
          lastErrorClass: null,
          lastSkipReason: null,
          requestedHost: health.requestedHost ?? health.usedHost ?? null,
          lastUsedHost: health.usedHost ?? null,
          lastUsedModel: health.usedModel ?? null,
          lastFallbackUsed: health.fallbackUsed === true,
        },
        updatedAt: iso(timestamp),
      };
      const validated = validateState(next);
      assertCapsuleBudget(validated);
      const decorated = decorate(validated, timestamp);
      await atomicWriteJson(statePath, validated);
      await appendAudit(dir, { event: 'reaction.commit', status: 'applied', version: validated.version }).catch(() => {});
      return {
        status: 'applied',
        state: decorated,
        rebased,
        changedBandIds: [...new Set(applied.trail.map((entry) => entry.band))],
      };
    }, lockWaitMs);
  }

  async function recordReactionHealth({ status, errorCode = null, skipReason = null, requestedHost = null }) {
    return withLock(dir, async () => {
      const stored = await readPersisted();
      if (!stored) return null;
      const timestamp = now();
      const next = validateState({
        ...stored,
        reactionHealth: {
          ...stored.reactionHealth,
          status,
          lastStartedAt: status === 'running' ? iso(timestamp) : stored.reactionHealth.lastStartedAt,
          lastCompletedAt: status === 'running' ? stored.reactionHealth.lastCompletedAt : iso(timestamp),
          lastErrorClass: status === 'degraded' ? errorCode : null,
          lastSkipReason: status === 'skipped' ? skipReason : null,
          requestedHost,
        },
        updatedAt: iso(timestamp),
      });
      await atomicWriteJson(statePath, next);
      await appendAudit(dir, { event: 'reaction.health', status, errorCode, version: next.version }).catch(() => {});
      return decorate(next, timestamp);
    }, lockWaitMs);
  }

  async function erase({ expectedVersion }) {
    return withLock(dir, async () => {
      const stored = await readPersisted();
      const version = stored?.version ?? 0;
      if (version !== expectedVersion) throw new ConflictError();
      await rm(statePath, { force: true });
      await rm(path.join(dir, 'audit.jsonl'), { force: true });
      await rm(path.join(dir, 'audit.jsonl.1'), { force: true });
      await rm(path.join(dir, 'jobs'), { recursive: true, force: true });
      await rm(path.join(dir, '.event-key'), { force: true });
      await rm(dashboardPreferencesPath, { force: true });
      const residuals = (await readdir(dir).catch(() => [])).filter((name) => (
        /^state\.corrupt\.\d+\.json$/u.test(name)
        || /^\.state\.json\..+\.tmp$/u.test(name)
        || /^\.state\.lock\.stale\./u.test(name)
        || /^\.state\.lock\.release\./u.test(name)
      ));
      await Promise.all(residuals.map((name) => rm(path.join(dir, name), { recursive: true, force: true })));
      return { erased: true };
    }, lockWaitMs);
  }

  async function exists() {
    try {
      await access(statePath);
      return true;
    } catch {
      return false;
    }
  }

  return {
    dir,
    statePath,
    dashboardPreferencesPath,
    read,
    readPersisted,
    exists,
    setEnabled,
    updateBand,
    applyProfile,
    updateProfile,
    reset,
    commitReaction,
    recordReactionHealth,
    readDashboardPreferences,
    setDashboardPreferences,
    erase,
  };
}

export { DEFAULT_REACTION_INSTRUCTION };
