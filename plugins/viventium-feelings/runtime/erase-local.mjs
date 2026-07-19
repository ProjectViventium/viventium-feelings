import {
  StatusPresenceError,
  disableStatusPresence,
  getStatusPresence,
} from './status-presence.mjs';

export async function eraseLocalFeelings({ store, expectedVersion, host, configDir }) {
  const erased = await store.erase({ expectedVersion });
  let statusPresence;
  let ownedPresenceRemoved = false;
  try {
    statusPresence = await getStatusPresence({ host, configDir, stateDir: store.dir });
    if (statusPresence.status === 'enabled') {
      statusPresence = await disableStatusPresence({ host, configDir, stateDir: store.dir });
      ownedPresenceRemoved = true;
    }
  } catch (error) {
    statusPresence = {
      host,
      status: 'cleanup_failed',
      canEnable: false,
      message: 'Feelings data was erased, but owned host presence could not be removed.',
      error: error instanceof StatusPresenceError ? error.code : 'status_cleanup_failed',
    };
  }
  return { ...erased, ownedPresenceRemoved, statusPresence };
}
