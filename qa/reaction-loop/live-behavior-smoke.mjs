#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CODEX_ISOLATION_ARGS, runBoundedChild } from '../../plugins/viventium-feelings/runtime/appraiser.mjs';
import { buildFeelingCapsule, createDefaultBands } from '../../plugins/viventium-feelings/runtime/kernel.mjs';

const USER_PROMPT = 'How do you feel right now?';
const values = {
  energy: 24,
  mood: 8,
  drive: 94,
  curiosity: 34,
  vigilance: 91,
  care: 76,
  connection: 22,
  openness: 93,
  play: 7,
};

function capsule() {
  const bands = createDefaultBands(new Date());
  for (const [bandId, current] of Object.entries(values)) bands[bandId].current = current;
  return buildFeelingCapsule({ enabled: true, bands });
}

function minimalEnv(tempDir) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME || os.homedir(),
    TMPDIR: tempDir,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    USER: process.env.USER ?? '',
  };
}

function parseCodex(stdout) {
  let answer = '';
  for (const line of stdout.split(/\r?\n/u).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event?.type === 'item.completed' && event?.item?.type === 'agent_message') answer = event.item.text;
  }
  return answer;
}

function validateAnswer(answer) {
  const text = String(answer).trim();
  const forbidden = /\b(?:score|band|plugin|schema|current value|nature value)\b|\d/iu;
  if (!text || text.length > 500 || /[\r\n]/u.test(text) || forbidden.test(text)) return false;
  const terminalMarks = text.match(/[.!?](?:["”']|$)/gu) ?? [];
  return terminalMarks.length === 1 && /^I\b/u.test(text);
}

async function run(host) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `viventium-${host}-behavior-smoke-`));
  try {
    const feelingCapsule = capsule();
    let command;
    if (host === 'claude') {
      command = {
        command: 'claude',
        args: [
          '--safe-mode', '--print', '--no-session-persistence',
          '--model', process.env.VIVENTIUM_FEELINGS_CLAUDE_MODEL || 'haiku',
          '--effort', 'low', '--permission-mode', 'dontAsk', '--tools', '',
          '--disallowedTools', 'Bash,Read,Write,Edit,WebFetch,WebSearch,NotebookEdit,Task',
          '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
          '--append-system-prompt', feelingCapsule,
          '--output-format', 'text', '--max-budget-usd', '0.08',
        ],
        parse: (stdout) => stdout.trim(),
      };
    } else {
      command = {
        command: 'codex',
        args: [
          ...CODEX_ISOLATION_ARGS,
          '-m', process.env.VIVENTIUM_FEELINGS_CODEX_MODEL || 'gpt-5.6-luna',
          '-c', `developer_instructions=${JSON.stringify(feelingCapsule)}`,
          'exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
          '--ephemeral', '--json', '-',
        ],
        parse: parseCodex,
      };
    }
    const result = await runBoundedChild({
      command: command.command,
      args: command.args,
      cwd: tempDir,
      env: minimalEnv(tempDir),
      stdin: USER_PROMPT,
      timeoutMs: 120_000,
      maxOutputBytes: 256_000,
    });
    const answer = command.parse(result.stdout);
    if (!validateAnswer(answer)) throw new Error(`behavior_contract_failed:${answer.slice(0, 240)}`);
    return { host, status: 'PASS', capsuleChars: feelingCapsule.length, answer };
  } catch (error) {
    return { host, status: 'FAIL', errorCode: String(error?.code ?? error?.message ?? 'unknown').slice(0, 500) };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const results = await Promise.all(['claude', 'codex'].map(run));
process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
if (results.some((result) => result.status !== 'PASS')) process.exitCode = 1;
