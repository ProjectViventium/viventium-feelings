import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

const RECLAIM_CLAIM = '.reclaim.json';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readJson(filePath) {
  return readFile(filePath, 'utf8').then((value) => JSON.parse(value)).catch(() => null);
}

async function directorySnapshot(lockPath, ownerName, staleMs) {
  let handle;
  let keepHandle = false;
  try {
    handle = await open(lockPath, 'r');
    const details = await handle.stat();
    const pathDetails = await stat(lockPath);
    if (details.dev !== pathDetails.dev || details.ino !== pathDetails.ino) return null;
    if (Date.now() - details.mtimeMs <= staleMs) return null;
    const owner = await readJson(path.join(lockPath, ownerName));
    if (processIsAlive(owner?.pid)) return null;
    keepHandle = true;
    return { dev: details.dev, ino: details.ino, token: owner?.token ?? null, handle };
  } catch {
    return null;
  } finally {
    if (handle && !keepHandle) await handle.close().catch(() => {});
  }
}

async function matchesDirectorySnapshot(lockPath, ownerName, expected) {
  try {
    const pinned = await expected.handle.stat();
    const details = await stat(lockPath);
    const owner = await readJson(path.join(lockPath, ownerName));
    return pinned.dev === expected.dev
      && pinned.ino === expected.ino
      && details.dev === expected.dev
      && details.ino === expected.ino
      && (owner?.token ?? null) === expected.token
      && !processIsAlive(owner?.pid);
  } catch {
    return false;
  }
}

async function writeOwner(lockPath, ownerName, token) {
  const ownerPath = path.join(lockPath, ownerName);
  const handle = await open(ownerPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, token })}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ownsClaim(lockPath, token) {
  return (await readJson(path.join(lockPath, RECLAIM_CLAIM)))?.token === token;
}

async function releaseClaim(lockPath, token) {
  const claimPath = path.join(lockPath, RECLAIM_CLAIM);
  if (await ownsClaim(lockPath, token)) await rm(claimPath, { force: true });
}

async function clearAbandonedClaim(lockPath, staleMs) {
  const claimPath = path.join(lockPath, RECLAIM_CLAIM);
  let claimHandle;
  try {
    const lockDetails = await stat(lockPath);
    claimHandle = await open(claimPath, 'r');
    const details = await claimHandle.stat();
    const pathDetails = await stat(claimPath);
    if (details.dev !== pathDetails.dev || details.ino !== pathDetails.ino) return false;
    const claim = await claimHandle.readFile('utf8').then((value) => JSON.parse(value)).catch(() => null);
    const claimAgeMs = Date.now() - details.mtimeMs;
    if (processIsAlive(claim?.pid) && claimAgeMs <= staleMs) return false;
    if (!Number.isInteger(claim?.pid) && claimAgeMs <= staleMs) return false;
    const expected = {
      dev: details.dev,
      ino: details.ino,
      token: claim?.token ?? null,
      lockAtime: Number.isFinite(claim?.lockAtimeMs) ? new Date(claim.lockAtimeMs) : lockDetails.atime,
      lockMtime: Number.isFinite(claim?.lockMtimeMs) ? new Date(claim.lockMtimeMs) : lockDetails.mtime,
    };
    const tombstone = `${claimPath}.stale.${process.pid}.${randomBytes(6).toString('hex')}`;
    await rename(claimPath, tombstone);
    const moved = await stat(tombstone).catch(() => null);
    const movedClaim = await readJson(tombstone);
    if (moved?.dev === expected.dev && moved?.ino === expected.ino
      && (movedClaim?.token ?? null) === expected.token) {
      await rm(tombstone, { force: true });
      await utimes(lockPath, expected.lockAtime, expected.lockMtime).catch(() => {});
      return true;
    }
    await rename(tombstone, claimPath).catch(() => {});
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(error?.code)) throw error;
  } finally {
    await claimHandle?.close().catch(() => {});
  }
  return false;
}

async function acquireClaim(lockPath, staleMs) {
  const claimPath = path.join(lockPath, RECLAIM_CLAIM);
  const token = randomBytes(16).toString('hex');
  let handle;
  try {
    const lockDetails = await stat(lockPath);
    handle = await open(claimPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      pid: process.pid,
      token,
      lockAtimeMs: lockDetails.atimeMs,
      lockMtimeMs: lockDetails.mtimeMs,
    })}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    return token;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === 'EEXIST') {
      await clearAbandonedClaim(lockPath, staleMs);
      return null;
    }
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function reclaimStaleDirectory(lockPath, ownerName, snapshot, staleMs) {
  const claimToken = await acquireClaim(lockPath, staleMs);
  if (!claimToken) return false;
  let tombstone = null;
  try {
    if (!await ownsClaim(lockPath, claimToken)) return false;
    if (!await matchesDirectorySnapshot(lockPath, ownerName, snapshot)) return false;
    tombstone = `${lockPath}.stale.${process.pid}.${randomBytes(6).toString('hex')}`;
    await rename(lockPath, tombstone);
    const now = new Date();
    await utimes(tombstone, now, now).catch(() => {});
    if (!await ownsClaim(tombstone, claimToken)
      || !await matchesDirectorySnapshot(tombstone, ownerName, snapshot)) {
      await rename(tombstone, lockPath).catch(() => {});
      return false;
    }
    await rm(tombstone, { recursive: true, force: true });
    tombstone = null;
    return true;
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(error?.code)) throw error;
    return false;
  } finally {
    await releaseClaim(lockPath, claimToken);
    if (tombstone) await releaseClaim(tombstone, claimToken);
  }
}

async function releaseOwnedDirectory(lockPath, ownerName, token) {
  let expected;
  try {
    const details = await stat(lockPath);
    const owner = await readJson(path.join(lockPath, ownerName));
    if (owner?.token !== token) return;
    expected = { ino: details.ino, token };
  } catch {
    return;
  }
  const tombstone = `${lockPath}.release.${process.pid}.${randomBytes(6).toString('hex')}`;
  try {
    await rename(lockPath, tombstone);
    const now = new Date();
    await utimes(tombstone, now, now).catch(() => {});
    const details = await stat(tombstone);
    const owner = await readJson(path.join(tombstone, ownerName));
    if (details.ino === expected.ino && owner?.token === token) {
      await rm(tombstone, { recursive: true, force: true });
    } else {
      await rename(tombstone, lockPath).catch(() => {});
    }
  } catch {
    // A missing or replaced lock is never ours to remove.
  }
}

async function pruneLockTombstones(parentDir, lockName, staleMs) {
  const prefixes = [`${lockName}.stale.`, `${lockName}.release.`];
  for (const name of await readdir(parentDir).catch(() => [])) {
    const prefix = prefixes.find((candidate) => name.startsWith(candidate));
    if (!prefix) continue;
    const target = path.join(parentDir, name);
    const details = await stat(target).catch(() => null);
    const ownerPid = Number.parseInt(name.slice(prefix.length).split('.')[0], 10);
    if (details && !processIsAlive(ownerPid) && Date.now() - details.mtimeMs > staleMs) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function withOwnedDirectoryLock({
  parentDir,
  lockName,
  ownerName = 'owner.json',
  staleMs,
  waitMs,
  timeoutCode,
  retryDelay = () => 20,
  operation,
}) {
  await mkdir(parentDir, { recursive: true, mode: 0o700 });
  await chmod(parentDir, 0o700);
  await pruneLockTombstones(parentDir, lockName, staleMs);
  const lockPath = path.join(parentDir, lockName);
  const deadline = Date.now() + waitMs;
  const token = randomBytes(16).toString('hex');
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeOwner(lockPath, ownerName, token);
      } catch (error) {
        if (['ENOENT', 'EEXIST'].includes(error?.code)) {
          if (Date.now() >= deadline) throw new Error(timeoutCode);
          await sleep(retryDelay());
          continue;
        }
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const snapshot = await directorySnapshot(lockPath, ownerName, staleMs);
      try {
        if (snapshot && await reclaimStaleDirectory(lockPath, ownerName, snapshot, staleMs)) continue;
      } finally {
        await snapshot?.handle?.close().catch(() => {});
      }
      if (Date.now() >= deadline) throw new Error(timeoutCode);
      await sleep(retryDelay());
    }
  }
  try {
    return await operation();
  } finally {
    await releaseOwnedDirectory(lockPath, ownerName, token);
  }
}
