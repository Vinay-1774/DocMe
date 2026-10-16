import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Starting Frontend OTP Registration Tests ---');

// 1. Verify register.html markup
const registerHtmlPath = path.join(projectRoot, 'frontend/pages/register.html');
const registerHtml = fs.readFileSync(registerHtmlPath, 'utf8');

const requiredElements = [
  'id="register-card"',
  'id="otp-card"',
  'id="register-form"',
  'id="otp-form"',
  'id="otp-input"',
  'id="otp-target-email"',
  'id="otp-countdown"',
  'id="otp-timer-badge"',
  'id="otp-verify-btn"',
  'id="otp-resend-btn"',
  'id="otp-back-btn"',
  'id="alert-container"',
  'id="alert-message"',
  'id="otp-alert-container"',
  'id="otp-alert-message"',
];

for (const el of requiredElements) {
  if (!registerHtml.includes(el)) {
    throw new Error(`register.html is missing required element: ${el}`);
  }
}
console.log('Test 1: register.html DOM Structure — PASSED');

// 2. Verify register.css styles
const registerCssPath = path.join(projectRoot, 'frontend/pages/register.css');
const registerCss = fs.readFileSync(registerCssPath, 'utf8');

const requiredCss = [
  '.otp-code-input',
  '.otp-timer-badge',
  '.otp-timer-badge.is-expired',
  '.otp-countdown-num',
  '.btn-link',
];

for (const rule of requiredCss) {
  if (!registerCss.includes(rule)) {
    throw new Error(`register.css is missing required rule: ${rule}`);
  }
}
console.log('Test 2: register.css Styling Rules — PASSED');

// 3. Verify api.js methods
const apiJsPath = path.join(projectRoot, 'frontend/shared/api.js');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');

if (!apiJs.includes('requestOtp(') || !apiJs.includes('verifyOtp(')) {
  throw new Error('api.js is missing requestOtp or verifyOtp methods');
}
console.log('Test 3: api.js OTP Methods — PASSED');

// 4. Verify register.js controller logic
const registerJsPath = path.join(projectRoot, 'frontend/pages/register.js');
const registerJs = fs.readFileSync(registerJsPath, 'utf8');

const requiredLogic = [
  'api.register(',
  'api.verifyOtp(',
  'api.requestOtp(',
  'showOtpScreen',
  'startCountdown',
  'stopCountdown',
  'completeLogin',
];

for (const fn of requiredLogic) {
  if (!registerJs.includes(fn)) {
    throw new Error(`register.js is missing logic: ${fn}`);
  }
}
console.log('Test 4: register.js Controller Logic — PASSED');

console.log('--- All Frontend OTP Registration Tests Completed Successfully ---');
