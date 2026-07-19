import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sessionKeyFor, submissionKeyFor } from './event-id.mjs';

const JOBS_DIR = 'jobs';
const ACTIVE_SLOT = '.active-reaction.json';
const QUEUE_LOCK = '.queue-lock';
const QUEUE_LOCK_OWNER = 'owner.json';
const MAX_PENDING_JOBS = 4;
const MAX_PENDING_JOB_AGE_MS = 30 * 60 * 1000;
const MAX_APPRAISAL_QUEUE_WAIT_MS = 10 * 60 * 1000;
const MAX_ACTIVE_SLOT_AGE_MS = 5 * 60 * 1000;
const STALE_QUEUE_LOCK_MS = 30_000;
const QUEUE_LOCK_WAIT_MS = 5_000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function jobPaths(stateDir, eventId) {
  const root = path.join(stateDir, JOBS_DIR);
  return {
    root,
    pending: path.join(root, `${eventId}.pending.json`),
    complete: path.join(root, `${eventId}.complete`),
  };
}

async function privateWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, filePath);
  await chmod(filePath, 0o600);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function queueLockSnapshot(lockPath) {
  try {
    const details = await stat(lockPath);
    if (Date.now() - details.mtimeMs <= STALE_QUEUE_LOCK_MS) return null;
    const owner = await readFile(path.join(lockPath, QUEUE_LOCK_OWNER), 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => ({}));
    return processIsAlive(owner.pid) ? null : { ino: details.ino, token: owner.token ?? null };
  } catch {
    return null;
  }
}

async function sameQueueLock(lockPath, expected) {
  try {
    const details = await stat(lockPath);
    const owner = await readFile(path.join(lockPath, QUEUE_LOCK_OWNER), 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => ({}));
    return details.ino === expected.ino && (owner.token ?? null) === expected.token
      && !processIsAlive(owner.pid);
  } catch {
    return false;
  }
}

async function releaseQueueLock(lockPath, token) {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, QUEUE_LOCK_OWNER), 'utf8'));
    if (owner.token === token) await rm(lockPath, { recursive: true, force: true });
  } catch {
    // A missing or replaced queue lock is never ours to remove.
  }
}

async function withQueueLock(stateDir, action) {
  const root = path.join(stateDir, JOBS_DIR);
  const lockPath = path.join(root, QUEUE_LOCK);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const deadline = Date.now() + QUEUE_LOCK_WAIT_MS;
  const token = randomBytes(16).toString('hex');
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await privateWrite(
          path.join(lockPath, QUEUE_LOCK_OWNER),
          `${JSON.stringify({ pid: process.pid, token })}\n`,
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const snapshot = await queueLockSnapshot(lockPath);
      if (snapshot && await sameQueueLock(lockPath, snapshot)) {
        const tombstone = `${lockPath}.stale.${process.pid}.${randomBytes(6).toString('hex')}`;
        try {
          await rename(lockPath, tombstone);
          if (await sameQueueLock(tombstone, snapshot)) {
            await rm(tombstone, { recursive: true, force: true });
          } else {
            await rename(tombstone, lockPath).catch(() => {});
          }
        } catch (reclaimError) {
          if (!['ENOENT', 'EEXIST'].includes(reclaimError?.code)) throw reclaimError;
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error('reaction_queue_lock_timeout');
      await sleep(20);
    }
  }
  try {
    return await action(root);
  } finally {
    await releaseQueueLock(lockPath, token);
  }
}

async function listPendingMetadata(jobsDir) {
  const pending = [];
  for (const name of await readdir(jobsDir).catch(() => [])) {
    if (!name.endsWith('.pending.json')) continue;
    try {
      const metadata = JSON.parse(await readFile(path.join(jobsDir, name), 'utf8'));
      if (metadata?.eventId) pending.push(metadata);
    } catch {
      // pruneJobs owns malformed-file cleanup.
    }
  }
  return pending;
}

export async function registerPending({ stateDir, eventId, input, metadata }) {
  const paths = jobPaths(stateDir, eventId);
  await pruneJobs(stateDir);
  const safe = {
    schemaVersion: 1,
    eventId,
    sessionKey: await sessionKeyFor(input, { dir: stateDir }),
    submissionKey: await submissionKeyFor(input, { dir: stateDir }),
    sequence: Number.isInteger(metadata.sequence) ? metadata.sequence : Date.now(),
    host: metadata.host,
    launchedAt: metadata.launchedAt,
    baseVersion: metadata.baseVersion,
    baseControlEpoch: metadata.baseControlEpoch,
  };
  return withQueueLock(stateDir, async () => {
    try {
      await access(paths.pending);
      return { accepted: false, reason: 'duplicate' };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const queued = await listPendingMetadata(paths.root);
    if (queued.length >= MAX_PENDING_JOBS) {
      return { accepted: false, reason: 'reaction_queue_full' };
    }
    await privateWrite(paths.pending, `${JSON.stringify(safe)}\n`);
    return { ...safe, accepted: true };
  });
}

export async function signalCompleted({ stateDir, input }) {
  const jobsDir = path.join(stateDir, JOBS_DIR);
  const sessionKey = await sessionKeyFor(input, { dir: stateDir });
  const submissionKey = await submissionKeyFor(input, { dir: stateDir });
  const candidates = [];
  for (const name of await readdir(jobsDir).catch(() => [])) {
    if (!name.endsWith('.pending.json')) continue;
    try {
      const filePath = path.join(jobsDir, name);
      const metadata = JSON.parse(await readFile(filePath, 'utf8'));
      if (metadata.sessionKey !== sessionKey) continue;
      if (submissionKey && metadata.submissionKey && metadata.submissionKey !== submissionKey) continue;
      candidates.push(metadata);
    } catch {
      // A malformed gate can never authorize a reaction.
    }
  }
  candidates.sort((a, b) => (
    Number(a.sequence) - Number(b.sequence)
    || String(a.launchedAt).localeCompare(String(b.launchedAt))
    || String(a.eventId).localeCompare(String(b.eventId))
  ));
  const selected = candidates[0];
  if (!selected) return { signalled: false, reason: 'no_pending_job' };
  const paths = jobPaths(stateDir, selected.eventId);
  await privateWrite(paths.complete, `${JSON.stringify({ completedAt: new Date().toISOString() })}\n`);
  return { signalled: true, eventId: selected.eventId };
}

export async function waitForCompleted({
  stateDir,
  eventId,
  timeoutMs = MAX_PENDING_JOB_AGE_MS,
  pollMs = 80,
}) {
  const paths = jobPaths(stateDir, eventId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(paths.complete);
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') return false;
    }
    await sleep(pollMs);
  }
  return false;
}

export async function acquireAppraisalSlot({
  stateDir,
  eventId,
  timeoutMs = MAX_APPRAISAL_QUEUE_WAIT_MS,
  pollMs = 80,
}) {
  const paths = jobPaths(stateDir, eventId);
  const activePath = path.join(paths.root, ACTIVE_SLOT);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pruneJobs(stateDir);
    const allPending = await listPendingMetadata(paths.root);
    if (!allPending.some((entry) => entry.eventId === eventId)) return false;
    const pending = [];
    for (const entry of allPending) {
      try {
        await access(jobPaths(stateDir, entry.eventId).complete);
        pending.push(entry);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    pending.sort((left, right) => (
      Number(left.sequence) - Number(right.sequence)
      || String(left.launchedAt).localeCompare(String(right.launchedAt))
      || String(left.eventId).localeCompare(String(right.eventId))
    ));
    if (pending[0]?.eventId === eventId) {
      let slot;
      try {
        slot = await open(activePath, 'wx', 0o600);
        await slot.writeFile(`${JSON.stringify({
          eventId,
          acquiredAt: new Date().toISOString(),
        })}\n`, 'utf8');
        await slot.sync();
        await slot.close();
        await chmod(activePath, 0o600);
        return true;
      } catch (error) {
        await slot?.close().catch(() => {});
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    await sleep(pollMs);
  }
  return false;
}

export async function clearJob({ stateDir, eventId }) {
  const paths = jobPaths(stateDir, eventId);
  await Promise.all([
    rm(paths.pending, { force: true }),
    rm(paths.complete, { force: true }),
  ]);
  const activePath = path.join(paths.root, ACTIVE_SLOT);
  try {
    const active = JSON.parse(await readFile(activePath, 'utf8'));
    if (active.eventId === eventId) await rm(activePath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') await rm(activePath, { force: true });
  }
}

export async function pruneJobs(stateDir, now = Date.now()) {
  const jobsDir = path.join(stateDir, JOBS_DIR);
  let activeEventId = null;
  try {
    const activePath = path.join(jobsDir, ACTIVE_SLOT);
    const active = JSON.parse(await readFile(activePath, 'utf8'));
    const acquired = new Date(active.acquiredAt ?? active.launchedAt).getTime();
    if (!active.eventId || !Number.isFinite(acquired) || now - acquired > MAX_ACTIVE_SLOT_AGE_MS) {
      await rm(activePath, { force: true });
    } else {
      activeEventId = active.eventId;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') await rm(path.join(jobsDir, ACTIVE_SLOT), { force: true });
  }
  const entries = await readdir(jobsDir).catch(() => []);
  const livePending = new Set();
  for (const name of entries) {
    if (!name.endsWith('.pending.json')) continue;
    const target = path.join(jobsDir, name);
    try {
      const metadata = JSON.parse(await readFile(target, 'utf8'));
      const fileEventId = metadata?.eventId;
      const launched = new Date(metadata?.launchedAt).getTime();
      if (!fileEventId || !Number.isFinite(launched) || now - launched > MAX_PENDING_JOB_AGE_MS) {
        await rm(target, { force: true });
        if (fileEventId) await rm(path.join(jobsDir, `${fileEventId}.complete`), { force: true });
        if (fileEventId === activeEventId) {
          await rm(path.join(jobsDir, ACTIVE_SLOT), { force: true });
          activeEventId = null;
        }
      } else {
        livePending.add(fileEventId);
      }
    } catch {
      await rm(target, { force: true });
    }
  }
  for (const name of entries) {
    if (!name.endsWith('.complete')) continue;
    const fileEventId = name.slice(0, -'.complete'.length);
    if (!livePending.has(fileEventId)) {
      await rm(path.join(jobsDir, name), { force: true });
    }
  }
}
