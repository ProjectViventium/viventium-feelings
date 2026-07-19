import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'viventium-feelings');

test('ships native Claude and Codex manifests over one shared plugin root', async () => {
  const codex = JSON.parse(await readFile(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codex.name, 'viventium-feelings');
  assert.equal(claude.name, 'viventium-feelings');
  assert.equal(codex.version, claude.version);
  assert.equal(codex.author.name, 'Adrien Beyk');
  assert.equal(claude.author.name, 'Adrien Beyk');
  assert.equal(codex.mcpServers, './.codex-mcp.json');
  assert.equal(claude.mcpServers, './.claude-mcp.json');
  assert.equal(claude.displayName, 'Viventium Feelings');
  assert.equal(codex.interface.composerIcon, './assets/viventium-v.png');
  assert.equal(codex.interface.logo, './assets/viventium-v.png');
  const codexMcp = JSON.parse(await readFile(path.join(PLUGIN, '.codex-mcp.json'), 'utf8'));
  const claudeMcp = JSON.parse(await readFile(path.join(PLUGIN, '.claude-mcp.json'), 'utf8'));
  assert.equal(codexMcp.mcpServers['viventium-feelings'].args[0], './runtime/mcp-server.mjs');
  assert.equal(codexMcp.mcpServers['viventium-feelings'].cwd, '.');
  assert.equal(codexMcp.mcpServers['viventium-feelings'].env.VIVENTIUM_FEELINGS_HOST, 'codex');
  assert.match(claudeMcp.mcpServers['viventium-feelings'].args[0], /\$\{CLAUDE_PLUGIN_ROOT\}/u);
  assert.equal(claudeMcp.mcpServers['viventium-feelings'].env.VIVENTIUM_FEELINGS_HOST, 'claude');
  assert.equal(claudeMcp.mcpServers['viventium-feelings'].env.CLAUDE_PLUGIN_DATA, undefined);
  assert.ok(!Object.hasOwn(codex, 'hooks'), 'Codex validator currently rejects a manifest hooks field');
});

test('marketplaces point at the same relative plugin root', async () => {
  const codex = JSON.parse(await readFile(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(codex.plugins[0].source.path, './plugins/viventium-feelings');
  assert.equal(claude.plugins[0].source, './plugins/viventium-feelings');
});

test('release version is consistent across package, host, marketplace, citation, and server surfaces', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const codex = JSON.parse(await readFile(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const citation = await readFile(path.join(ROOT, 'CITATION.cff'), 'utf8');
  const mcp = await readFile(path.join(PLUGIN, 'runtime', 'mcp-server.mjs'), 'utf8');
  const versions = [
    pkg.version, lock.version, lock.packages[''].version, codex.version, claude.version,
    marketplace.plugins[0].version,
  ];
  assert.ok(versions.every((version) => version === pkg.version), versions.join(','));
  assert.match(citation, new RegExp(`^version: ${pkg.version.replaceAll('.', '\\.')}$`, 'mu'));
  assert.match(mcp, new RegExp(`serverInfo: \\{ name: 'viventium-feelings', version: '${pkg.version.replaceAll('.', '\\.')}' \\}`, 'u'));
});

test('package contains hooks, skill, MCP server, dashboard, and legal controls', async () => {
  const required = [
    'hooks/hooks.json',
    'hooks/user-prompt-submit.mjs',
    'hooks/stop.mjs',
    'runtime/kernel.mjs',
    'runtime/state-store.mjs',
    'runtime/reaction-worker.mjs',
    'runtime/mcp-server.mjs',
    'runtime/erase-local.mjs',
    'runtime/status-presence.mjs',
    'dashboard/index.html',
    'dashboard/dashboard.css',
    'dashboard/dashboard.js',
    'dashboard/render.js',
    'dashboard/api.js',
    'dashboard/theme-init.js',
    'assets/viventium-v.png',
    'skills/feelings/agents/assets/viventium-v.png',
    'skills/feelings/SKILL.md',
  ];
  await Promise.all(required.map((relative) => access(path.join(PLUGIN, relative))));
  await Promise.all(['LICENSE', 'NOTICE', 'CITATION.cff', 'SECURITY.md'].map((relative) => access(path.join(ROOT, relative))));
});

test('public product copy does not claim consumer chat parity or vendor endorsement', async () => {
  const publicFiles = ['README.md', 'docs/COMPATIBILITY.md'];
  const text = (await Promise.all(publicFiles.map((file) => readFile(path.join(ROOT, file), 'utf8')))).join('\n');
  assert.doesNotMatch(text, /official (?:openai|anthropic)/iu);
  assert.doesNotMatch(text, /jailbreak/iu);
  assert.match(text, /Claude Code/iu);
  assert.match(text, /Codex/iu);
  assert.match(text, /unsupported|does not govern|not available/iu);
});

test('public docs disclose the exact embodied frame and contain no private runtime codenames', async () => {
  const { EMBODIED_FEELING_FRAME } = await import('../plugins/viventium-feelings/runtime/kernel.mjs');
  const files = ['README.md', 'docs/PRODUCT_CONTRACT.md', 'docs/ARCHITECTURE.md'];
  const documents = Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    await readFile(path.join(ROOT, file), 'utf8'),
  ])));
  assert.match(documents['README.md'], new RegExp(EMBODIED_FEELING_FRAME.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(documents['docs/PRODUCT_CONTRACT.md'], new RegExp(EMBODIED_FEELING_FRAME.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(Object.values(documents).join('\n'), /Phase B|GlassHive/u);
});
