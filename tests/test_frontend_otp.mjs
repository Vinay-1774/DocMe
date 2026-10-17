import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Starting Simplified Frontend Registration Tests ---');

// 1. Verify register.html markup
const registerHtmlPath = path.join(projectRoot, 'frontend/pages/register.html');
const registerHtml = fs.readFileSync(registerHtmlPath, 'utf8');

const requiredElements = [
  'id="register-card"',
  'id="register-form"',
  'id="username"',
  'id="email"',
  'id="password"',
  'id="register-submit-btn"',
  'id="alert-container"',
  'id="alert-message"',
];

for (const el of requiredElements) {
  if (!registerHtml.includes(el)) {
    throw new Error(`register.html is missing required element: ${el}`);
  }
}

// Ensure obsolete OTP elements are removed
const obsoleteOtpElements = [
  'id="otp-card"',
  'id="otp-form"',
  'id="otp-input"',
  'id="otp-countdown"',
  'id="otp-verify-btn"',
  'id="otp-resend-btn"',
];

for (const el of obsoleteOtpElements) {
  if (registerHtml.includes(el)) {
    throw new Error(`register.html should NOT contain obsolete element: ${el}`);
  }
}
console.log('Test 1: register.html DOM Structure (No OTP elements) — PASSED');

// 2. Verify api.js methods
const apiJsPath = path.join(projectRoot, 'frontend/shared/api.js');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');

if (!apiJs.includes('register(username, email, password)')) {
  throw new Error('api.js is missing register method');
}
if (!apiJs.includes('login(email, password)')) {
  throw new Error('api.js is missing login method');
}
if (apiJs.includes('requestOtp(') || apiJs.includes('verifyOtp(') || apiJs.includes('resendOtp(')) {
  throw new Error('api.js should NOT contain OTP methods (requestOtp, verifyOtp, resendOtp)');
}
console.log('Test 2: api.js Registration and Login Methods — PASSED');

// 3. Verify register.js controller logic
const registerJsPath = path.join(projectRoot, 'frontend/pages/register.js');
const registerJs = fs.readFileSync(registerJsPath, 'utf8');

const requiredLogic = [
  'api.register(',
  'login.html?registered=true',
];

for (const fn of requiredLogic) {
  if (!registerJs.includes(fn)) {
    throw new Error(`register.js is missing required logic: ${fn}`);
  }
}

const obsoleteLogic = [
  'showOtpScreen',
  'api.verifyOtp',
  'api.requestOtp',
  'startCountdown',
];

for (const fn of obsoleteLogic) {
  if (registerJs.includes(fn)) {
    throw new Error(`register.js should NOT contain obsolete OTP logic: ${fn}`);
  }
}
console.log('Test 3: register.js Controller Logic (Direct registration & redirect) — PASSED');

console.log('--- All Simplified Frontend Registration Tests Completed Successfully ---');

