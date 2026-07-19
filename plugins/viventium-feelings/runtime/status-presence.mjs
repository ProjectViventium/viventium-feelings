import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { withOwnedDirectoryLock } from './owned-directory-lock.mjs';

const MANAGED_DIRECTORY = 'viventium-feelings';
const MANAGED_SCRIPT = 'statusline.mjs';
const SETTINGS_LOCK = '.settings.lock';
const SETTINGS_LOCK_OWNER = 'settings-owner.json';
const SETTINGS_LOCK_STALE_MS = 30_000;
const SETTINGS_LOCK_WAIT_MS = 4_000;

export class StatusPresenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function claudeConfigDir(explicit) {
  return path.resolve(explicit || process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || os.homedir(), '.claude'));
}

function managedPaths(configDir) {
  const root = claudeConfigDir(configDir);
  const scriptPath = path.join(root, MANAGED_DIRECTORY, MANAGED_SCRIPT);
  return { root, settingsPath: path.join(root, 'settings.json'), scriptPath };
}

function shellCommand(scriptPath) {
  const encodedPath = Buffer.from(scriptPath, 'utf8').toString('base64');
  return `node --input-type=module -e "const{pathToFileURL}=await import('node:url');await import(pathToFileURL(Buffer.from('${encodedPath}','base64').toString()).href)"`;
}

async function writableSettingsPath(settingsPath) {
  try {
    return await realpath(settingsPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new StatusPresenceError('claude_settings_invalid');
    try {
      const metadata = await lstat(settingsPath);
      if (metadata.isSymbolicLink()) throw new StatusPresenceError('claude_settings_invalid');
    } catch (metadataError) {
      if (metadataError instanceof StatusPresenceError) throw metadataError;
      if (metadataError?.code !== 'ENOENT') throw new StatusPresenceError('claude_settings_invalid');
    }
    return settingsPath;
  }
}

async function readSettings(settingsPath) {
  return (await readSettingsSnapshot(settingsPath)).value;
}

async function readSettingsSnapshot(settingsPath) {
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return { value: parsed, raw };
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: {}, raw: null };
    throw new StatusPresenceError('claude_settings_invalid');
  }
}

async function currentRaw(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new StatusPresenceError('claude_settings_invalid');
  }
}

async function atomicWriteJson(filePath, value, expectedRaw) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (await currentRaw(filePath) !== expectedRaw) {
      throw new StatusPresenceError('claude_settings_changed');
    }
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function withSettingsLock(root, operation) {
  try {
    return await withOwnedDirectoryLock({
      parentDir: path.join(root, MANAGED_DIRECTORY),
      lockName: SETTINGS_LOCK,
      ownerName: SETTINGS_LOCK_OWNER,
      staleMs: SETTINGS_LOCK_STALE_MS,
      waitMs: SETTINGS_LOCK_WAIT_MS,
      timeoutCode: 'claude_settings_busy',
      operation,
    });
  } catch (error) {
    if (error instanceof StatusPresenceError) throw error;
    if (error?.message === 'claude_settings_busy') throw new StatusPresenceError('claude_settings_busy');
    throw error;
  }
}

function managedScript(statePath) {
  return `#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

for await (const _chunk of process.stdin) { /* consume Claude's session JSON */ }

try {
  const state = JSON.parse(await readFile(${JSON.stringify(statePath)}, 'utf8'));
  const enabled = state?.enabled === true;
  const health = String(state?.reactionHealth?.status || 'never');
  const skipReason = String(state?.reactionHealth?.lastSkipReason || '');
  const healthLabel = !enabled ? 'paused'
    : health === 'healthy' ? 'healthy'
      : health === 'running' ? 'reacting'
        : health === 'degraded' ? 'needs attention'
          : health === 'skipped' && skipReason === 'disabled' ? 'paused'
            : health === 'skipped' && ['reaction_queue_full', 'completion_timeout'].includes(skipReason) ? 'needs attention'
              : 'waiting';
  process.stdout.write(\`V Feelings · \${enabled ? 'On' : 'Off'} · \${healthLabel}\\n\`);
} catch {
  process.stdout.write('V Feelings · Not set up\\n');
}
`;
}

export async function getStatusPresence({ host, configDir, stateDir }) {
  if (host !== 'claude') {
    return {
      host,
      status: host === 'codex' ? 'native_branding' : 'unsupported',
      canEnable: false,
      message: host === 'codex'
        ? 'The V is available in Codex plugin and composer surfaces.'
        : 'This host has no supported status-presence integration.',
    };
  }
  const { settingsPath: configuredSettingsPath, scriptPath } = managedPaths(configDir);
  const settingsPath = await writableSettingsPath(configuredSettingsPath);
  const settings = await readSettings(settingsPath);
  const expectedCommand = shellCommand(scriptPath);
  const current = settings.statusLine;
  if (current?.type === 'command' && current.command === expectedCommand) {
    return { host, status: 'enabled', canEnable: true, message: 'V Feelings is shown in the Claude Code status line.' };
  }
  if (current !== undefined) {
    return {
      host,
      status: 'conflict',
      canEnable: false,
      message: 'Claude Code already has a custom status line. Viventium will not overwrite it.',
    };
  }
  return { host, status: 'available', canEnable: true, message: 'Add V Feelings to the Claude Code status line.' };
}

export async function enableStatusPresence({ host, configDir, stateDir }) {
  if (host !== 'claude') throw new StatusPresenceError('status_presence_unsupported');
  const { root, settingsPath: configuredSettingsPath, scriptPath } = managedPaths(configDir);
  return withSettingsLock(root, async () => {
    const settingsPath = await writableSettingsPath(configuredSettingsPath);
    const snapshot = await readSettingsSnapshot(settingsPath);
    const settings = snapshot.value;
    const expectedCommand = shellCommand(scriptPath);
    if (settings.statusLine !== undefined
        && !(settings.statusLine?.type === 'command' && settings.statusLine.command === expectedCommand)) {
      throw new StatusPresenceError('status_line_conflict');
    }
    await writeFile(scriptPath, managedScript(path.join(path.resolve(stateDir), 'state.json')), {
      encoding: 'utf8', mode: 0o700,
    });
    await chmod(scriptPath, 0o700);
    try {
      await atomicWriteJson(settingsPath, {
        ...settings,
        statusLine: { type: 'command', command: expectedCommand, refreshInterval: 2 },
      }, snapshot.raw);
    } catch (error) {
      if (settings.statusLine === undefined) await rm(scriptPath, { force: true }).catch(() => {});
      throw error;
    }
    return getStatusPresence({ host, configDir: root, stateDir });
  });
}

export async function disableStatusPresence({ host, configDir, stateDir }) {
  if (host !== 'claude') throw new StatusPresenceError('status_presence_unsupported');
  const { root, settingsPath: configuredSettingsPath, scriptPath } = managedPaths(configDir);
  return withSettingsLock(root, async () => {
    const settingsPath = await writableSettingsPath(configuredSettingsPath);
    const snapshot = await readSettingsSnapshot(settingsPath);
    const settings = snapshot.value;
    const expectedCommand = shellCommand(scriptPath);
    if (settings.statusLine !== undefined
        && !(settings.statusLine?.type === 'command' && settings.statusLine.command === expectedCommand)) {
      throw new StatusPresenceError('status_line_conflict');
    }
    if (settings.statusLine !== undefined) {
      const { statusLine: _ownedStatusLine, ...rest } = settings;
      await atomicWriteJson(settingsPath, rest, snapshot.raw);
    }
    await rm(scriptPath, { force: true });
    return getStatusPresence({ host, configDir: root, stateDir });
  });
}
