import { spawn } from 'node:child_process';
import path from 'node:path';

import { clearJob, registerPending, signalCompleted } from './completion-gate.mjs';
import { boundedStimulus, eventIdFor } from './event-id.mjs';
import { createStateStore, resolveStateDir } from './state-store.mjs';

function sequenceFor(input) {
  const value = Number(input?.turn_id ?? input?.prompt_sequence);
  return Number.isSafeInteger(value) ? value : Date.now();
}

export function launchDetachedWorker(payload, { pluginRoot = path.resolve(import.meta.dirname, '..') } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const child = spawn(process.execPath, [path.join(pluginRoot, 'runtime', 'reaction-worker.mjs')], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        USER: process.env.USER ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        TMPDIR: process.env.TMPDIR ?? '',
        PLUGIN_DATA: process.env.PLUGIN_DATA ?? '',
        CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA ?? '',
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? '',
        CODEX_HOME: process.env.CODEX_HOME ?? '',
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        VIVENTIUM_FEELINGS_HOST: payload.host,
        VIVENTIUM_FEELINGS_REACTION_CHILD: '1',
      },
    });
    child.once('error', finish);
    child.stdin.once('error', finish);
    child.once('spawn', () => {
      child.unref();
      child.stdin.end(JSON.stringify(payload), () => finish());
    });
  });
}

export async function handleUserPrompt({
  input,
  store = createStateStore(),
  stateDir = resolveStateDir(),
  host,
  launchWorker = (payload) => launchDetachedWorker(payload),
  eventIdFactory = eventIdFor,
  registerJob = registerPending,
}) {
  if (process.env.VIVENTIUM_FEELINGS_REACTION_CHILD === '1') return null;
  const state = await store.read();
  if (!state.enabled || !state.capsule) return null;
  const context = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: state.capsule,
    },
  };
  if (state.reactionActivationMode === 'disabled') return context;
  try {
    const eventId = await eventIdFactory(input, { dir: stateDir });
    if (state.processedStimulusKeys.includes(eventId)) return context;
    const launchedAt = new Date().toISOString();
    const payload = {
      eventId,
      sessionId: typeof input?.session_id === 'string' ? input.session_id : '',
      sequence: sequenceFor(input),
      launchedAt,
      baseVersion: state.version,
      baseControlEpoch: state.controlEpoch,
      host,
      stimulus: boundedStimulus(input?.prompt),
    };
    const pending = await registerJob({ stateDir, eventId, input, metadata: payload });
    if (!pending.accepted) {
      if (pending.reason === 'reaction_queue_full') {
        await store.recordReactionHealth({
          status: 'skipped',
          skipReason: pending.reason,
          requestedHost: host,
        }).catch(() => {});
      }
      return context;
    }
    // Close the boundary where the original worker committed and cleared its
    // pending gate after our first read but before this registration. At every
    // point either the original pending file or the processed ledger prevents a
    // second paid appraisal for the same host event.
    const latest = await store.read();
    if (latest.processedStimulusKeys.includes(eventId)) {
      await clearJob({ stateDir, eventId });
      return context;
    }
    try {
      await launchWorker(payload);
    } catch {
      await clearJob({ stateDir, eventId });
    }
  } catch {
    // Reaction coordination is optional to the foreground turn. Once built,
    // the capsule must survive a queue, key, or worker-control failure.
  }
  return context;
}

export async function handleStop({ input, stateDir = resolveStateDir() }) {
  if (process.env.VIVENTIUM_FEELINGS_REACTION_CHILD === '1') return { signalled: false, reason: 'child' };
  if (typeof input?.last_assistant_message !== 'string' || !input.last_assistant_message.trim()) {
    return { signalled: false, reason: 'no_completed_output' };
  }
  return signalCompleted({ stateDir, input });
}
