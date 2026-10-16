import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Testing Register DOM Event Handling & Validation ---');

// Mock DOM elements
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
}

class MockElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.style = { display: '' };
    this.classList = new MockClassList();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] || null; }
  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }
  async dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      await h(event);
    }
  }
  focus() {}
}

const elements = {
  'register-card': new MockElement('register-card'),
  'register-form': new MockElement('register-form', 'form'),
  'username': new MockElement('username', 'input'),
  'email': new MockElement('email', 'input'),
  'password': new MockElement('password', 'input'),
  'username-error': new MockElement('username-error'),
  'email-error': new MockElement('email-error'),
  'password-error': new MockElement('password-error'),
  'register-submit-btn': new MockElement('register-submit-btn', 'button'),
  'btn-label': new MockElement('btn-label', 'span'),
  'btn-spinner': new MockElement('btn-spinner', 'span'),
  'password-toggle-btn': new MockElement('password-toggle-btn', 'button'),
  'eye-icon': new MockElement('eye-icon', 'svg'),
  'eye-off-icon': new MockElement('eye-off-icon', 'svg'),
  'otp-card': Object.assign(new MockElement('otp-card'), { style: { display: 'none' } }),
  'otp-form': new MockElement('otp-form', 'form'),
  'otp-input': new MockElement('otp-input', 'input'),
  'otp-input-error': new MockElement('otp-input-error'),
  'otp-target-email': new MockElement('otp-target-email'),
  'otp-countdown': new MockElement('otp-countdown'),
  'otp-timer-badge': new MockElement('otp-timer-badge'),
  'otp-verify-btn': new MockElement('otp-verify-btn', 'button'),
  'otp-verify-label': new MockElement('otp-verify-label', 'span'),
  'otp-verify-spinner': new MockElement('otp-verify-spinner', 'span'),
  'otp-resend-btn': new MockElement('otp-resend-btn', 'button'),
  'resend-countdown-text': new MockElement('resend-countdown-text'),
  'otp-back-btn': new MockElement('otp-back-btn', 'button'),
  'alert-container': new MockElement('alert-container'),
  'alert-message': new MockElement('alert-message'),
  'otp-alert-container': new MockElement('otp-alert-container'),
  'otp-alert-message': new MockElement('otp-alert-message'),
};

global.document = {
  getElementById: (id) => elements[id] || null,
  addEventListener: (event, handler) => {
    if (event === 'DOMContentLoaded') handler();
  },
};

global.window = {
  location: { href: '', pathname: '/pages/register.html' },
  DOCME_API_URL: 'http://localhost:8000',
};

global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

global.Event = class {
  constructor(type, opts = {}) {
    this.type = type;
    this.cancelable = opts.cancelable || false;
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
};

// Now import the register.js module
await import('../frontend/pages/register.js');

console.log('Test 1: Empty submit triggers username validation error');
let submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['username-error'].textContent, 'Username is required.');
assert.strictEqual(elements['username-error'].style.display, 'flex');
console.log('  PASSED');

console.log('Test 2: Short username triggers validation error');
elements['username'].value = 'al';
submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['username-error'].textContent, 'Username must be at least 3 characters.');
console.log('  PASSED');

console.log('Test 3: Missing email triggers validation error');
elements['username'].value = 'alice_test';
elements['email'].value = '';
submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['email-error'].textContent, 'Email address is required.');
console.log('  PASSED');

console.log('Test 4: Invalid email format triggers validation error');
elements['email'].value = 'notanemail';
submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['email-error'].textContent, 'Please enter a valid email address.');
console.log('  PASSED');

console.log('Test 5: Short password triggers validation error');
elements['email'].value = 'alice@example.com';
elements['password'].value = '123';
submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['password-error'].textContent, 'Password must be at least 6 characters.');
console.log('  PASSED');

// Test 6: Existing email address (API returns 400 Bad Request)
console.log('Test 6: Existing email address displays error message');
elements['username'].value = 'alice_test';
elements['email'].value = 'alice@example.com';
elements['password'].value = 'SecurePassword123!';

global.fetch = async () => ({
  ok: false,
  status: 400,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({ detail: 'A user with this email is already registered.' }),
});

submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['alert-message'].textContent, 'A user with this email is already registered.');
assert.strictEqual(elements['alert-container'].style.display, 'flex');
assert.strictEqual(elements['email-error'].textContent, 'A user with this email is already registered.');
console.log('  PASSED');

// Test 7: Email provider failure (API returns 503 Service Unavailable)
console.log('Test 7: Email-provider failure displays 503 service alert without breaking form');
elements['username'].value = 'bob_test';
elements['email'].value = 'bob@example.com';
elements['password'].value = 'SecurePassword123!';

global.fetch = async () => ({
  ok: false,
  status: 503,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({
    detail: 'User account created, but unable to deliver verification email at this time. Please check SMTP configuration or request a code resend.'
  }),
});

submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.ok(elements['alert-message'].textContent.includes('unable to deliver verification email'));
assert.strictEqual(elements['alert-container'].style.display, 'flex');
console.log('  PASSED');

// Test 8: Successful registration triggers OTP verification screen transition
console.log('Test 8: Successful registration transitions to OTP verification screen');
elements['username'].value = 'carol_test';
elements['email'].value = 'carol@example.com';
elements['password'].value = 'SecurePassword123!';

global.fetch = async () => ({
  ok: true,
  status: 201,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({
    id: 99,
    username: 'carol_test',
    email: 'carol@example.com',
    is_verified: false,
    created_at: new Date().toISOString()
  }),
});

submitEvent = new global.Event('submit', { cancelable: true });
await elements['register-form'].dispatchEvent(submitEvent);
assert.strictEqual(elements['register-card'].style.display, 'none');
assert.strictEqual(elements['otp-card'].style.display, 'block');
assert.strictEqual(elements['otp-target-email'].textContent, 'carol@example.com');
console.log('  PASSED');

console.log('--- All Register DOM Tests Passed Successfully ---');
