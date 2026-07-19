import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { eventIdFor } from '../plugins/viventium-feelings/runtime/event-id.mjs';

test('host submission IDs distinguish repeated text while true retries deduplicate', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-event-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shared = { session_id: 'synthetic-session', prompt: 'continue' };
  const claudeFirst = await eventIdFor({ ...shared, prompt_id: 'prompt-a' }, { dir });
  const claudeRetry = await eventIdFor({ ...shared, prompt_id: 'prompt-a' }, { dir });
  const claudeRepeat = await eventIdFor({ ...shared, prompt_id: 'prompt-b' }, { dir });
  const codexRepeat = await eventIdFor({ ...shared, turn_id: 'turn-b' }, { dir });
  assert.equal(claudeFirst, claudeRetry);
  assert.notEqual(claudeFirst, claudeRepeat);
  assert.notEqual(claudeRepeat, codexRepeat);
  assert.match(claudeFirst, /^stimulus-[a-f0-9]{24}$/u);
});

test('fallback IDs are keyed and do not disclose prompt text', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'viventium-event-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = await eventIdFor({ session_id: 'synthetic-session', prompt: 'private prompt text' }, { dir });
  assert.doesNotMatch(id, /private|prompt|text/u);
});
