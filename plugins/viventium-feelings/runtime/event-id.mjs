import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const MAX_STIMULUS_CHARS = 16_000;
const KEY_FILE = '.event-key';

export function boundedStimulus(value) {
  const source = typeof value === 'string' ? value : '';
  if (source.length <= MAX_STIMULUS_CHARS) return source;
  const half = Math.floor((MAX_STIMULUS_CHARS - 11) / 2);
  return `${source.slice(0, half)}\n[bounded]\n${source.slice(-half)}`;
}

export async function coordinationKey(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const keyPath = path.join(dir, KEY_FILE);
  try {
    const handle = await open(keyPath, 'wx', 0o600);
    try {
      await handle.writeFile(randomBytes(32));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  await chmod(keyPath, 0o600);
  const key = await readFile(keyPath);
  if (key.length !== 32) {
    await rm(keyPath, { force: true });
    throw new Error('event_key_invalid');
  }
  return key;
}

async function keyedDigest(dir, namespace, value) {
  const key = await coordinationKey(dir);
  return createHmac('sha256', key)
    .update(`${namespace}\0${String(value ?? '')}`)
    .digest('hex');
}

export async function sessionKeyFor(input, { dir } = {}) {
  return keyedDigest(dir, 'session', input?.session_id ?? '');
}

export async function submissionKeyFor(input, { dir } = {}) {
  const submission = typeof input?.turn_id === 'string' && input.turn_id
    ? `turn:${input.turn_id}`
    : (typeof input?.prompt_id === 'string' && input.prompt_id
        ? `prompt:${input.prompt_id}`
        : '');
  if (!submission) return null;
  return keyedDigest(dir, 'submission', submission);
}

export async function eventIdFor(input, { dir } = {}) {
  const key = await coordinationKey(dir);
  const submission = typeof input?.turn_id === 'string' && input.turn_id
    ? `turn:${input.turn_id}`
    : (typeof input?.prompt_id === 'string' && input.prompt_id
        ? `prompt:${input.prompt_id}`
        : '');
  const identity = JSON.stringify({
    session: typeof input?.session_id === 'string' ? input.session_id : '',
    submission,
    transcript: typeof input?.transcript_path === 'string' ? input.transcript_path : '',
    prompt: submission ? '' : boundedStimulus(input?.prompt),
  });
  return `stimulus-${createHmac('sha256', key).update(identity).digest('hex').slice(0, 24)}`;
}
