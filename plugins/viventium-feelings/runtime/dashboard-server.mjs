import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { ConflictError, ValidationError, createStateStore } from './state-store.mjs';

const DASHBOARD_ROOT = path.resolve(import.meta.dirname, '..', 'dashboard');
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = 'viventium_dashboard';
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
});

function securityHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  response.end(`${JSON.stringify(value)}\n`);
}

function cookieValue(request, name) {
  for (const part of String(request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function secretEqual(value, expected) {
  if (typeof value !== 'string') return false;
  const candidate = Buffer.from(value);
  const reference = Buffer.from(expected);
  return candidate.length === reference.length && timingSafeEqual(candidate, reference);
}

async function readJson(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new ValidationError('content_type_invalid');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new ValidationError('body_too_large');
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ValidationError();
  return parsed;
}

function onlyKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ValidationError();
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(?:index\.html|dashboard\.css|dashboard\.js|api\.js|render\.js)$/u.test(relative)) {
    sendJson(response, 404, { error: { code: 'not_found' } });
    return;
  }
  const filePath = path.join(DASHBOARD_ROOT, relative);
  const details = await stat(filePath);
  response.writeHead(200, {
    ...securityHeaders(CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream'),
    'content-length': details.size,
  });
  createReadStream(filePath).pipe(response);
}

export async function startDashboardServer({
  store = createStateStore(),
  host = 'unknown',
  port = 0,
  idleTimeoutMs = 30 * 60 * 1000,
} = {}) {
  const token = randomBytes(32).toString('base64url');
  let origin;
  let idleTimer;
  let closed = false;
  const resetIdle = () => {
    if (!idleTimeoutMs) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => server.close(), idleTimeoutMs);
    idleTimer.unref();
  };
  const server = http.createServer(async (request, response) => {
    resetIdle();
    try {
      const hostHeader = String(request.headers.host ?? '');
      if (!origin || ![`127.0.0.1:${new URL(origin).port}`, `localhost:${new URL(origin).port}`].includes(hostHeader)) {
        sendJson(response, 421, { error: { code: 'host_invalid' } });
        return;
      }
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname === '/favicon.ico' && request.method === 'GET') {
        response.writeHead(204, securityHeaders('image/x-icon'));
        response.end();
        return;
      }
      if (!url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: { code: 'method_not_allowed' } });
          return;
        }
        await serveStatic(request, response, url.pathname);
        return;
      }
      if (url.pathname === '/api/session' && request.method === 'POST') {
        if (!secretEqual(request.headers.authorization, `Bearer ${token}`)) {
          sendJson(response, 401, { error: { code: 'unauthorized' } });
          return;
        }
        if (request.headers.origin && request.headers.origin !== origin) {
          sendJson(response, 403, { error: { code: 'origin_invalid' } });
          return;
        }
        response.writeHead(204, {
          ...securityHeaders('application/json; charset=utf-8'),
          'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        response.end();
        return;
      }
      const bearerAuthorized = secretEqual(request.headers.authorization, `Bearer ${token}`);
      const cookieAuthorized = secretEqual(cookieValue(request, SESSION_COOKIE), token);
      if (!bearerAuthorized && !cookieAuthorized) {
        sendJson(response, 401, { error: { code: 'unauthorized' } });
        return;
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        sendJson(response, 403, { error: { code: 'origin_invalid' } });
        return;
      }
      if (url.pathname === '/api/state' && request.method === 'GET') {
        sendJson(response, 200, { state: await store.read(), host });
        return;
      }
      const body = await readJson(request);
      if (url.pathname === '/api/enabled' && request.method === 'PATCH') {
        onlyKeys(body, ['expectedVersion', 'enabled']);
        sendJson(response, 200, { state: await store.setEnabled(body) });
        return;
      }
      if (url.pathname.startsWith('/api/bands/') && request.method === 'PATCH') {
        onlyKeys(body, ['expectedVersion', 'patch']);
        const bandId = decodeURIComponent(url.pathname.slice('/api/bands/'.length));
        sendJson(response, 200, { state: await store.updateBand({ ...body, bandId }) });
        return;
      }
      if (url.pathname === '/api/profile' && request.method === 'POST') {
        onlyKeys(body, ['expectedVersion', 'profileId', 'resetCurrent']);
        sendJson(response, 200, { state: await store.applyProfile(body) });
        return;
      }
      if (url.pathname === '/api/settings' && request.method === 'PATCH') {
        onlyKeys(body, ['expectedVersion', 'patch']);
        sendJson(response, 200, { state: await store.updateProfile(body) });
        return;
      }
      if (url.pathname === '/api/reset' && request.method === 'POST') {
        onlyKeys(body, ['expectedVersion']);
        sendJson(response, 200, { state: await store.reset(body) });
        return;
      }
      if (url.pathname === '/api/state' && request.method === 'DELETE') {
        onlyKeys(body, ['expectedVersion']);
        sendJson(response, 200, await store.erase(body));
        return;
      }
      sendJson(response, 404, { error: { code: 'not_found' } });
    } catch (error) {
      if (error instanceof ConflictError) {
        sendJson(response, 409, { error: { code: error.code } });
      } else if (error instanceof ValidationError || error instanceof SyntaxError) {
        sendJson(response, 422, { error: { code: error.code ?? 'json_invalid' } });
      } else {
        sendJson(response, 500, { error: { code: 'internal_error' } });
      }
    }
  });
  server.once('close', () => {
    closed = true;
    clearTimeout(idleTimer);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  resetIdle();
  return {
    token,
    origin,
    url: `${origin}/#${token}`,
    isClosed: () => closed,
    close: () => new Promise((resolve) => {
      if (closed) return resolve();
      clearTimeout(idleTimer);
      server.close(resolve);
    }),
  };
}
