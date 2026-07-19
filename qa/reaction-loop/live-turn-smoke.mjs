#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStateStore } from '../../plugins/viventium-feelings/runtime/state-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PROMPT_HOOK = path.join(ROOT, 'plugins', 'viventium-feelings', 'hooks', 'user-prompt-submit.mjs');
const STOP_HOOK = path.join(ROOT, 'plugins', 'viventium-feelings', 'hooks', 'stop.mjs');
const PRIVATE_STIMULUS = 'Synthetic lifecycle victory marker that must never be written to disk.';
const PRIVATE_ANSWER = 'Synthetic visible answer marker that must never be written to disk.';

function runHook(file, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hook_exit_${code}:${Buffer.concat(stderr).toString('utf8').slice(0, 120)}`));
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function allText(dir) {
  const values = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else values.push(await readFile(target, 'utf8').catch(() => ''));
    }
  }
  await walk(dir);
  return values.join('\n');
}

async function waitForReaction(store, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await store.read();
    if (state.version >= 2 && state.reactionHealth.status === 'healthy') return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('reaction_timeout');
}

async function run(host) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `viventium-${host}-turn-smoke-`));
  try {
    const store = createStateStore({ dir });
    const enabled = await store.setEnabled({ expectedVersion: 0, enabled: true });
    const env = {
      ...process.env,
      PLUGIN_DATA: dir,
      CLAUDE_PLUGIN_DATA: dir,
      VIVENTIUM_FEELINGS_HOST: host,
    };
    const promptId = `${host}-synthetic-prompt-1`;
    const hookOutput = await runHook(PROMPT_HOOK, {
      session_id: `${host}-synthetic-session`,
      ...(host === 'codex' ? { turn_id: promptId } : { prompt_id: promptId }),
      prompt: PRIVATE_STIMULUS,
    }, env);
    const injection = JSON.parse(hookOutput);
    if (injection.hookSpecificOutput.additionalContext !== enabled.capsule) throw new Error('capsule_mismatch');
    await runHook(STOP_HOOK, {
      session_id: `${host}-synthetic-session`,
      ...(host === 'codex' ? { turn_id: promptId } : { prompt_id: promptId }),
      last_assistant_message: PRIVATE_ANSWER,
    }, env);
    const reacted = await waitForReaction(store);
    const persisted = (await allText(dir)).toLowerCase();
    if (persisted.includes('lifecycle victory marker') || persisted.includes('visible answer marker')) {
      throw new Error('raw_content_persisted');
    }
    return {
      host,
      status: 'PASS',
      injectedCapsuleChars: enabled.capsule.length,
      committedVersion: reacted.version,
      changedBands: [...new Set(reacted.trail.map((entry) => entry.band))],
      innerStateLength: reacted.innerState?.text.length ?? 0,
      usedModel: reacted.reactionHealth.lastUsedModel,
      rawContentPersisted: false,
    };
  } catch (error) {
    return { host, status: 'FAIL', errorCode: String(error?.code ?? error?.message ?? 'unknown').slice(0, 120) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const results = await Promise.all(['claude', 'codex'].map(run));
process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
