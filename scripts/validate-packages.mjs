#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'viventium-feelings');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${Buffer.concat(stdout).toString('utf8')}\n${Buffer.concat(stderr).toString('utf8')}`;
      if (code !== 0) return reject(new Error(`${command}_validation_failed:${output.slice(0, 800)}`));
      resolve(output);
    });
  });
}

async function filesUnder(dir) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else files.push(target);
    }
  }
  await walk(dir);
  return files;
}

for (const file of await filesUnder(PLUGIN)) {
  if (!/\.(?:json|ya?ml|md|mjs|js|css|html)$/u.test(file)) continue;
  const content = await readFile(file, 'utf8');
  if (/\[TODO|TODO:/u.test(content)) throw new Error(`placeholder_found:${path.relative(ROOT, file)}`);
}

JSON.parse(await readFile(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));
JSON.parse(await readFile(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
JSON.parse(await readFile(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
JSON.parse(await readFile(path.join(PLUGIN, '.claude-mcp.json'), 'utf8'));
JSON.parse(await readFile(path.join(PLUGIN, '.codex-mcp.json'), 'utf8'));

if (process.argv.includes('--static-only')) {
  process.stdout.write('PASS: static manifests and placeholder scan.\n');
  process.exit(0);
}

await run('claude', ['plugin', 'validate', '--strict', PLUGIN], { cwd: ROOT, env: process.env });
await run('claude', ['plugin', 'validate', '--strict', ROOT], { cwd: ROOT, env: process.env });

const codexHome = await mkdtemp(path.join(os.tmpdir(), 'viventium-codex-validate-'));
const claudeHome = await mkdtemp(path.join(os.tmpdir(), 'viventium-claude-validate-'));
try {
  await run('codex', ['plugin', 'marketplace', 'add', ROOT, '--json'], {
    cwd: ROOT, env: { ...process.env, CODEX_HOME: codexHome },
  });
  await run('codex', ['plugin', 'add', 'viventium-feelings@project-viventium', '--json'], {
    cwd: ROOT, env: { ...process.env, CODEX_HOME: codexHome },
  });
  const codexInstalled = await run('codex', ['plugin', 'list', '--json'], {
    cwd: ROOT, env: { ...process.env, CODEX_HOME: codexHome },
  });
  if (!codexInstalled.includes('viventium-feelings')) throw new Error('codex_install_not_listed');
  await run('claude', ['plugin', 'marketplace', 'add', ROOT, '--scope', 'user'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  await run('claude', ['plugin', 'install', 'viventium-feelings@project-viventium', '--scope', 'user'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  const claudeInstalled = await run('claude', ['plugin', 'list', '--json'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  if (!claudeInstalled.includes('viventium-feelings')) throw new Error('claude_install_not_listed');
  await run('claude', ['plugin', 'marketplace', 'update', 'project-viventium'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  await run('claude', ['plugin', 'update', 'viventium-feelings@project-viventium', '--scope', 'user'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  await run('codex', ['plugin', 'remove', 'viventium-feelings@project-viventium', '--json'], {
    cwd: ROOT, env: { ...process.env, CODEX_HOME: codexHome },
  });
  const codexRemoved = await run('codex', ['plugin', 'list', '--json'], {
    cwd: ROOT, env: { ...process.env, CODEX_HOME: codexHome },
  });
  if (/"installed"\s*:\s*true[^}]*viventium-feelings|viventium-feelings[^}]*"installed"\s*:\s*true/u.test(codexRemoved)) {
    throw new Error('codex_remove_failed');
  }
  await run('claude', ['plugin', 'uninstall', 'viventium-feelings@project-viventium', '--scope', 'user', '--yes'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  const claudeRemoved = await run('claude', ['plugin', 'list', '--json'], {
    cwd: ROOT, env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
  if (/viventium-feelings/u.test(claudeRemoved)) throw new Error('claude_remove_failed');
} finally {
  await rm(codexHome, { recursive: true, force: true });
  await rm(claudeHome, { recursive: true, force: true });
}

process.stdout.write('PASS: manifests plus isolated Claude/Codex install/list/removal and Claude local update.\n');
