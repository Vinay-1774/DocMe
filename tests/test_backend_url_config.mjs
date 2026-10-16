/**
 * tests/test_backend_url_config.mjs
 * Comprehensive validation for DocMe Backend URL Configuration and Vercel Deployment.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Starting DocMe Backend URL Configuration Tests ---');

// Mock browser globals for testing api.js in Node
const mockStorage = new Map();
global.localStorage = {
  getItem: (k) => mockStorage.get(k) || null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

const domMetaTags = new Map();
global.document = {
  querySelector: (sel) => {
    if (sel.includes('meta[name="docme-api-url"]')) {
      const content = domMetaTags.get('docme-api-url');
      return content ? { content } : null;
    }
    if (sel.includes('meta[name="research-api-url"]')) {
      const content = domMetaTags.get('research-api-url');
      return content ? { content } : null;
    }
    return null;
  },
  getElementById: () => null,
  createElement: () => ({ setAttribute: () => {}, style: {} }),
  addEventListener: () => {},
  body: {
    prepend: () => {},
  },
  readyState: 'complete',
};

global.window = {
  location: {
    hostname: 'localhost',
    protocol: 'http:',
    port: '5500',
    origin: 'http://localhost:5500',
    pathname: '/',
    search: '',
  },
  DOCME_API_URL: undefined,
  RESEARCH_API_URL: undefined,
};

async function runConfigTests() {
  const apiModule = await import('../frontend/shared/api.js');

  // Test 1: Local development (localhost) defaults to port 8000
  console.log('Test 1: Local development (localhost) resolves to http://localhost:8000');
  global.window.location.hostname = 'localhost';
  global.window.location.port = '5500';
  global.window.location.protocol = 'http:';
  mockStorage.clear();
  domMetaTags.clear();
  delete global.window.DOCME_API_URL;
  delete global.window.RESEARCH_API_URL;

  assert.strictEqual(apiModule.getDefaultApiBaseUrl(), 'http://localhost:8000');
  console.log('  PASSED');

  // Test 2: Local development (127.0.0.1) aligns hostname
  console.log('Test 2: Local development (127.0.0.1) resolves to http://127.0.0.1:8000');
  global.window.location.hostname = '127.0.0.1';
  assert.strictEqual(apiModule.getDefaultApiBaseUrl(), 'http://127.0.0.1:8000');
  console.log('  PASSED');

  // Test 3: Port 8000 reflects origin
  console.log('Test 3: Port 8000 returns window.location.origin');
  global.window.location.hostname = '127.0.0.1';
  global.window.location.port = '8000';
  global.window.location.origin = 'http://127.0.0.1:8000';
  assert.strictEqual(apiModule.getDefaultApiBaseUrl(), 'http://127.0.0.1:8000');
  console.log('  PASSED');

  // Reset port
  global.window.location.port = '5500';

  // Test 4: Production hostname (docme-platform.vercel.app) with valid DOCME_API_URL
  console.log('Test 4: Production hostname with window.DOCME_API_URL');
  global.window.location.hostname = 'docme-platform.vercel.app';
  global.window.location.protocol = 'https:';
  global.window.DOCME_API_URL = 'https://docme-backend.onrender.com';

  assert.strictEqual(
    apiModule.getDefaultApiBaseUrl(),
    'https://docme-backend.onrender.com'
  );
  console.log('  PASSED');

  // Test 5: Trailing slashes are stripped
  console.log('Test 5: Trailing slashes are automatically stripped');
  global.window.DOCME_API_URL = 'https://docme-backend.onrender.com///';
  assert.strictEqual(
    apiModule.getDefaultApiBaseUrl(),
    'https://docme-backend.onrender.com'
  );
  console.log('  PASSED');

  // Test 6: Production hostname without API URL throws configuration error and does NOT fall back to localhost
  console.log('Test 6: Production hostname without API URL throws explicit configuration error');
  delete global.window.DOCME_API_URL;
  delete global.window.RESEARCH_API_URL;
  mockStorage.clear();
  domMetaTags.clear();

  assert.throws(
    () => apiModule.getDefaultApiBaseUrl(),
    (err) => {
      assert.ok(err.message.includes('DocMe Configuration Error'));
      assert.ok(err.message.includes('docme-platform.vercel.app'));
      assert.ok(err.message.includes('DOCME_API_URL'));
      return true;
    },
    'Must throw clear configuration error on production host when API URL is missing'
  );
  console.log('  PASSED (Refuses silent localhost fallback in production)');

  // Test 7: Production hostname configured with localhost address throws error
  console.log('Test 7: Production hostname configured with localhost address throws error');
  global.window.DOCME_API_URL = 'http://localhost:8000';
  assert.throws(
    () => apiModule.getDefaultApiBaseUrl(),
    (err) => {
      assert.ok(err.message.includes('DocMe Configuration Error'));
      assert.ok(err.message.includes('cannot connect to a local address'));
      return true;
    }
  );
  delete global.window.DOCME_API_URL;
  console.log('  PASSED');

  // Test 8: Invalid URL protocol throws error
  console.log('Test 8: Invalid URL protocol throws error');
  global.window.DOCME_API_URL = 'ftp://docme-backend.onrender.com';
  assert.throws(
    () => apiModule.getDefaultApiBaseUrl(),
    (err) => {
      assert.ok(err.message.includes('DocMe Configuration Error'));
      assert.ok(err.message.includes('Invalid backend API URL format'));
      return true;
    }
  );
  delete global.window.DOCME_API_URL;
  console.log('  PASSED');

  // Test 9: Meta tag <meta name="docme-api-url"> is respected
  console.log('Test 9: Meta tag <meta name="docme-api-url"> is respected');
  global.window.location.hostname = 'docme-platform.vercel.app';
  domMetaTags.set('docme-api-url', 'https://api-meta.onrender.com/');
  assert.strictEqual(
    apiModule.getDefaultApiBaseUrl(),
    'https://api-meta.onrender.com'
  );
  domMetaTags.clear();
  console.log('  PASSED');

  // Test 10: Build Script CLI — Production build with valid Render URL
  console.log('Test 10: Build Script CLI injection for production');
  const testRenderUrl = 'https://docme-test-backend.onrender.com';
  execSync(`node scripts/build.js`, {
    cwd: projectRoot,
    env: { ...process.env, DOCME_API_URL: testRenderUrl, VERCEL: '1' },
    stdio: 'pipe',
  });

  const envJsContent = fs.readFileSync(path.join(projectRoot, 'frontend/shared/env.js'), 'utf8');
  assert.ok(
    envJsContent.includes(`DOCME_API_URL: "https://docme-test-backend.onrender.com"`),
    'env.js must contain injected DOCME_API_URL'
  );

  const loginHtmlContent = fs.readFileSync(path.join(projectRoot, 'frontend/pages/login.html'), 'utf8');
  assert.ok(
    loginHtmlContent.includes(`<meta name="docme-api-url" content="https://docme-test-backend.onrender.com">`),
    'login.html must contain synchronized meta tag'
  );
  console.log('  PASSED (env.js and HTML meta tags synchronized with Render URL)');

  // Test 11: Build Script CLI — Fails fast with clear instructions if DOCME_API_URL missing in production
  console.log('Test 11: Build Script CLI fails fast on missing DOCME_API_URL in production');
  let buildFailed = false;
  try {
    execSync(`node scripts/build.js`, {
      cwd: projectRoot,
      env: { ...process.env, DOCME_API_URL: '', VERCEL: '1' },
      stdio: 'pipe',
    });
  } catch (err) {
    buildFailed = true;
    const stderr = err.stderr ? err.stderr.toString() : '';
    assert.ok(
      stderr.includes('[DocMe Build Error] Missing Production Backend API URL') ||
      stderr.includes('DOCME_API_URL'),
      'Stderr must provide actionable guidance for Vercel settings'
    );
  }
  assert.strictEqual(buildFailed, true, 'Build must exit with non-zero exit code when URL is missing in production');
  console.log('  PASSED (Build failed cleanly with actionable instructions)');

  // Test 12: Build Script CLI — Fails fast if localhost URL provided in production
  console.log('Test 12: Build Script CLI fails if localhost provided in production');
  let localhostBuildFailed = false;
  try {
    execSync(`node scripts/build.js`, {
      cwd: projectRoot,
      env: { ...process.env, DOCME_API_URL: 'http://localhost:8000', VERCEL: '1' },
      stdio: 'pipe',
    });
  } catch (err) {
    localhostBuildFailed = true;
    const stderr = err.stderr ? err.stderr.toString() : '';
    assert.ok(
      stderr.includes('Localhost Detected') ||
      stderr.includes('cannot connect to localhost'),
      'Stderr must warn about localhost in production'
    );
  }
  assert.strictEqual(localhostBuildFailed, true, 'Build must exit with non-zero code on localhost in production');
  console.log('  PASSED (Localhost prevented in production build)');

  // Test 13: Secret isolation check — No backend credentials ever present in frontend files
  console.log('Test 13: Secret isolation check');
  const frontendSharedFiles = fs.readdirSync(path.join(projectRoot, 'frontend/shared'));
  for (const file of frontendSharedFiles) {
    const filePath = path.join(projectRoot, 'frontend/shared', file);
    if (!fs.statSync(filePath).isFile()) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(!content.includes('JWT_SECRET_KEY'), `Secrets leaked in ${file}`);
    assert.ok(!content.includes('GEMINI_API_KEY'), `Secrets leaked in ${file}`);
    assert.ok(!content.includes('DATABASE_URL'), `Secrets leaked in ${file}`);
    assert.ok(!content.includes('DB_PASSWORD'), `Secrets leaked in ${file}`);
    assert.ok(!content.includes('SMTP_PASSWORD'), `Secrets leaked in ${file}`);
  }
  console.log('  PASSED (Zero backend secrets in frontend assets)');

  // Test 14: Reset build back to local development defaults
  console.log('Test 14: Clean build reset back to local development defaults');
  execSync(`node scripts/build.js --clean`, {
    cwd: projectRoot,
    stdio: 'pipe',
  });
  const resetEnvContent = fs.readFileSync(path.join(projectRoot, 'frontend/shared/env.js'), 'utf8');
  assert.ok(
    resetEnvContent.includes(`DOCME_API_URL: ""`),
    'env.js must be reset to empty for local development'
  );
  console.log('  PASSED');

  console.log('--- All Backend URL Configuration Tests Passed Successfully ---');
}

runConfigTests().catch((err) => {
  console.error('Test Failure:', err);
  process.exit(1);
});
