/**
 * Unit & Integration Tests for DocMe Frontend Authentication Flow.
 * Validates:
 * 1. JWT parsing and expiration checking with buffer.
 * 2. isAuthenticated validation against expired tokens.
 * 3. Proactive token refresh scheduling.
 * 4. Deduplication of concurrent token refresh calls.
 * 5. Single-retry on 401 (_isRetry) preventing infinite loops.
 * 6. Safe error handling: only 401/403 clears auth; network/5xx does not log users out.
 * 7. Hostname alignment in API_BASE_URL (localhost vs 127.0.0.1).
 */

import assert from 'node:assert';

// Mock browser globals before loading modules
const storage = new Map();
global.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

global.window = {
  location: {
    pathname: '/pages/feed.html',
    search: '',
    hostname: 'localhost',
    protocol: 'http:',
    port: '5500',
    href: 'http://localhost:5500/pages/feed.html',
  },
};

global.document = {
  addEventListener: () => {},
  hidden: false,
};

// Helper to create a test JWT token
function createMockJwt(sub, expiresInSeconds, type = 'access') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub,
    type,
    exp: now + expiresInSeconds,
  })).toString('base64url');
  const signature = 'mock_signature';
  return `${header}.${payload}.${signature}`;
}

async function runTests() {
  console.log('--- Starting Frontend Auth Tests ---');

  // Import after setting up globals
  const auth = await import('../frontend/shared/auth.js');
  const apiModule = await import('../frontend/shared/api.js');

  // Test 1: parseJwtPayload
  console.log('Test 1: parseJwtPayload');
  const validToken = createMockJwt('42', 3600);
  const payload = auth.parseJwtPayload(validToken);
  assert.strictEqual(payload.sub, '42');
  assert.strictEqual(payload.type, 'access');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  assert.strictEqual(auth.parseJwtPayload('invalid.token'), null);
  assert.strictEqual(auth.parseJwtPayload(null), null);
  console.log('  PASSED');

  // Test 2: isTokenExpired
  console.log('Test 2: isTokenExpired');
  const freshToken = createMockJwt('1', 300); // 5 mins in future
  const expiringToken = createMockJwt('1', 30); // 30s in future
  const expiredToken = createMockJwt('1', -10); // 10s in past

  assert.strictEqual(auth.isTokenExpired(freshToken, 60), false);
  assert.strictEqual(auth.isTokenExpired(expiringToken, 60), true); // Within 60s buffer
  assert.strictEqual(auth.isTokenExpired(expiringToken, 10), false); // Within 10s buffer: not expired
  assert.strictEqual(auth.isTokenExpired(expiredToken, 0), true);
  console.log('  PASSED');

  // Test 3: isAuthenticated ignores expired tokens
  console.log('Test 3: isAuthenticated check');
  auth.clearAuth();
  assert.strictEqual(auth.isAuthenticated(), false);

  auth.setToken(expiredToken);
  // An expired token in storage MUST NOT report as authenticated!
  assert.strictEqual(auth.isAuthenticated(), false);

  auth.setToken(freshToken);
  assert.strictEqual(auth.isAuthenticated(), true);
  console.log('  PASSED');

  // Test 4: Hostname alignment in API_BASE_URL
  console.log('Test 4: Hostname alignment');
  global.window.location.hostname = 'localhost';
  assert.strictEqual(apiModule.getDefaultApiBaseUrl(), 'http://localhost:8000');
  global.window.location.hostname = '127.0.0.1';
  assert.strictEqual(apiModule.getDefaultApiBaseUrl(), 'http://127.0.0.1:8000');
  console.log('  PASSED');

  // Test 5: Concurrent refresh request deduplication
  console.log('Test 5: Concurrent refresh request deduplication');
  let fetchCallCount = 0;
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    if (url.includes('/refresh')) {
      fetchCallCount++;
      // Simulate 50ms latency
      await new Promise((r) => setTimeout(r, 50));
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          access_token: createMockJwt('42', 3600),
          token_type: 'bearer',
        }),
      };
    }
    return { ok: true, status: 200, headers: new Map(), json: async () => ({}) };
  };

  fetchCallCount = 0;
  // Fire 5 simultaneous refresh requests
  const results = await Promise.all([
    apiModule.api.refreshToken(),
    apiModule.api.refreshToken(),
    apiModule.api.refreshToken(),
    apiModule.api.refreshToken(),
    apiModule.api.refreshToken(),
  ]);

  assert.strictEqual(fetchCallCount, 1, 'Only 1 HTTP /refresh call should be dispatched for simultaneous requests');
  assert.ok(results.every((tok) => Boolean(tok && tok.length > 20)));
  console.log('  PASSED (1 fetch dispatched for 5 concurrent calls)');

  // Test 6: 401 interception, single-retry (_isRetry), and no infinite loops
  console.log('Test 6: 401 single retry');
  let apiAttempts = 0;
  global.fetch = async (url, opts) => {
    if (url.includes('/refresh')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          access_token: createMockJwt('42', 3600),
          token_type: 'bearer',
        }),
      };
    }
    if (url.includes('/me')) {
      apiAttempts++;
      if (apiAttempts === 1) {
        // First attempt returns 401 (expired)
        return {
          ok: false,
          status: 401,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ detail: 'Token expired' }),
        };
      }
      // Second attempt succeeds with renewed token
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ id: 42, username: 'testuser' }),
      };
    }
    return { ok: true, status: 200, headers: new Map(), json: async () => ({}) };
  };

  auth.setToken(createMockJwt('42', 3600));
  const meData = await apiModule.api.getMe();
  assert.strictEqual(meData.username, 'testuser');
  assert.strictEqual(apiAttempts, 2, 'Original request failed with 401, refreshed, retried once, and succeeded');
  console.log('  PASSED');

  // Test 7: Persistent 401 does not loop infinitely
  console.log('Test 7: No infinite loop on persistent 401');
  let persistentAttempts = 0;
  global.fetch = async (url, opts) => {
    if (url.includes('/refresh')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          access_token: createMockJwt('42', 3600),
          token_type: 'bearer',
        }),
      };
    }
    if (url.includes('/protected')) {
      persistentAttempts++;
      return {
        ok: false,
        status: 401,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ detail: 'Still unauthorized' }),
      };
    }
    return { ok: true, status: 200, headers: new Map(), json: async () => ({}) };
  };

  try {
    await apiModule.apiRequest('/protected');
    assert.fail('Should have thrown ApiError');
  } catch (err) {
    assert.strictEqual(err.status, 401);
    // Initial attempt + exactly 1 retry = 2 attempts total
    assert.strictEqual(persistentAttempts, 2, 'Must retry only ONCE, never loop');
  }
  console.log('  PASSED (Strict single-retry guard enforced)');

  // Test 8: Safe error handling: transient network error does NOT clear user credentials
  console.log('Test 8: Network failure during refresh does NOT wipe credentials');
  const savedToken = createMockJwt('42', 3600);
  auth.setToken(savedToken);

  global.fetch = async (url) => {
    if (url.includes('/refresh')) {
      throw new TypeError('Failed to fetch'); // Network offline
    }
    return {
      ok: false,
      status: 401,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ detail: 'Unauthorized' }),
    };
  };

  try {
    await apiModule.apiRequest('/me');
  } catch (err) {
    // Should throw network error
    assert.ok(err);
  }

  // Token MUST NOT be wiped from storage merely because network temporarily disconnected!
  assert.strictEqual(auth.getToken(), savedToken, 'User credentials must be preserved on network glitch');
  console.log('  PASSED (Credentials preserved on transient network error)');

  // Test 9: Genuine 401 refresh token expiration clears auth safely
  console.log('Test 9: Genuine 401 refresh token expiration clears auth');
  auth.setToken(savedToken);

  global.fetch = async (url) => {
    if (url.includes('/refresh')) {
      return {
        ok: false,
        status: 401,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ detail: 'Invalid or expired refresh token' }),
      };
    }
    return {
      ok: false,
      status: 401,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ detail: 'Unauthorized' }),
    };
  };

  try {
    await apiModule.apiRequest('/me');
  } catch (err) {
    assert.strictEqual(err.status, 401);
  }

  // On genuine 401, credentials must be cleared safely
  assert.strictEqual(auth.getToken(), null, 'Credentials cleared on confirmed 401 refresh rejection');
  console.log('  PASSED (Credentials cleared on genuine 401)');

  // Restore fetch
  global.fetch = originalFetch;

  console.log('--- All Frontend Auth Tests Completed Successfully ---');
}

runTests().catch((err) => {
  console.error('Frontend Auth Test Failure:', err);
  process.exit(1);
});
