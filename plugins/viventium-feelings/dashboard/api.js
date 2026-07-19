let token = location.hash.slice(1);
if (token) {
  const session = await fetch('/api/session', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!session.ok) throw new Error('dashboard_session_failed');
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  token = '';
}

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch(route, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error?.code ?? 'request_failed', response.status);
  return result;
}

export const api = Object.freeze({
  state: () => request('/api/state'),
  enabled: (expectedVersion, enabled) => request('/api/enabled', { method: 'PATCH', body: { expectedVersion, enabled } }),
  band: (expectedVersion, bandId, patch) => request(`/api/bands/${encodeURIComponent(bandId)}`, { method: 'PATCH', body: { expectedVersion, patch } }),
  profile: (expectedVersion, profileId) => request('/api/profile', { method: 'POST', body: { expectedVersion, profileId, resetCurrent: true } }),
  settings: (expectedVersion, patch) => request('/api/settings', { method: 'PATCH', body: { expectedVersion, patch } }),
  theme: (theme) => request('/api/dashboard-preferences', { method: 'PATCH', body: { theme } }),
  statusPresence: () => request('/api/status-presence'),
  setStatusPresence: (action) => request('/api/status-presence', { method: 'POST', body: { action } }),
  reset: (expectedVersion) => request('/api/reset', { method: 'POST', body: { expectedVersion } }),
  erase: (expectedVersion) => request('/api/state', { method: 'DELETE', body: { expectedVersion } }),
});
