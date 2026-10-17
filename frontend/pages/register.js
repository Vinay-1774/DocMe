/**
 * pages/register.js
 * Controller for the Research Platform Registration & OTP Verification Flow.
 * Handles 2-step registration: account creation -> 6-digit OTP verification
 * with live 30-second countdown, resend cooldown, and automatic post-verify login.
 */

import { api, ApiError } from '../shared/api.js';
import { setToken, setUser, redirectIfAuthenticated } from '../shared/auth.js';

function initRegisterPage() {
  // If already authenticated, redirect to feed
  if (redirectIfAuthenticated('feed.html')) {
    return;
  }

  // DOM Elements - Registration Form
  const registerCard = document.getElementById('register-card');
  const registerForm = document.getElementById('register-form');
  const usernameInput = document.getElementById('username');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const usernameError = document.getElementById('username-error');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const registerSubmitBtn = document.getElementById('register-submit-btn');
  const btnLabel = document.getElementById('btn-label');
  const btnSpinner = document.getElementById('btn-spinner');
  const passwordToggleBtn = document.getElementById('password-toggle-btn');
  const eyeIcon = document.getElementById('eye-icon');
  const eyeOffIcon = document.getElementById('eye-off-icon');

  // DOM Elements - OTP Verification Screen
  const otpCard = document.getElementById('otp-card');
  const otpForm = document.getElementById('otp-form');
  const otpInput = document.getElementById('otp-input');
  const otpInputError = document.getElementById('otp-input-error');
  const otpTargetEmail = document.getElementById('otp-target-email');
  const otpCountdown = document.getElementById('otp-countdown');
  const otpTimerBadge = document.getElementById('otp-timer-badge');
  const otpVerifyBtn = document.getElementById('otp-verify-btn');
  const otpVerifyLabel = document.getElementById('otp-verify-label');
  const otpVerifySpinner = document.getElementById('otp-verify-spinner');
  const otpResendBtn = document.getElementById('otp-resend-btn');
  const resendCountdownText = document.getElementById('resend-countdown-text');
  const otpBackBtn = document.getElementById('otp-back-btn');

  // Global Alert Boxes (Registration Card and OTP Card)
  const alertContainer = document.getElementById('alert-container');
  const alertMessage = document.getElementById('alert-message');
  const otpAlertContainer = document.getElementById('otp-alert-container');
  const otpAlertMessage = document.getElementById('otp-alert-message');

  // Flow State
  let pendingRegistration = { username: '', email: '', password: '' };
  let countdownTimer = null;
  let remainingSeconds = 30;
  let isRegistering = false;
  let isVerifying = false;

  // Toggle Password Visibility
  if (passwordToggleBtn) {
    passwordToggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      eyeIcon.style.display = isPassword ? 'none' : 'block';
      eyeOffIcon.style.display = isPassword ? 'block' : 'none';
      passwordToggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // Real-time input error clearing
  usernameInput.addEventListener('input', () => hideFieldError(usernameInput, usernameError));
  emailInput.addEventListener('input', () => hideFieldError(emailInput, emailError));
  passwordInput.addEventListener('input', () => hideFieldError(passwordInput, passwordError));

  // Restrict OTP input to numbers only
  otpInput.addEventListener('input', () => {
    otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
    hideFieldError(otpInput, otpInputError);
    if (otpInput.value.length === 6 && !isVerifying) {
      // Auto-submit when user finishes entering 6 digits
      otpForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // Step 1: Submit Registration Form
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isRegistering) return;
    clearAlert();

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    let isValid = true;

    if (!username) {
      showFieldError(usernameInput, usernameError, 'Username is required.');
      isValid = false;
    } else if (username.length < 3) {
      showFieldError(usernameInput, usernameError, 'Username must be at least 3 characters.');
      isValid = false;
    }

    if (!email) {
      showFieldError(emailInput, emailError, 'Email address is required.');
      isValid = false;
    } else if (!isValidEmail(email)) {
      showFieldError(emailInput, emailError, 'Please enter a valid email address.');
      isValid = false;
    }

    if (!password) {
      showFieldError(passwordInput, passwordError, 'Password is required.');
      isValid = false;
    } else if (password.length < 6) {
      showFieldError(passwordInput, passwordError, 'Password must be at least 6 characters.');
      isValid = false;
    }

    if (!isValid) return;

    isRegistering = true;
    setRegisterLoading(true);

    try {
      // Call POST /register
      const user = await api.register(username, email, password);
      pendingRegistration = { username, email, password };

      setRegisterLoading(false);

      if (user && user.is_verified === false) {
        // Transition to OTP verification screen
        showOtpScreen(email);
      } else {
        // Verification was not required or pre-verified; log in immediately
        await completeLogin(email, password);
      }

    } catch (err) {
      setRegisterLoading(false);
      if (err instanceof ApiError) {
        if (err.status === 503 && err.message.toLowerCase().includes('user account created')) {
          pendingRegistration = { username, email, password };
          showOtpScreen(email);
          showAlert(err.message + ' Click "Resend Code" to retry delivery.', 'warning');
          otpResendBtn.disabled = false;
          resendCountdownText.textContent = '';
          return;
        }
        showAlert(err.message, 'error');
        if (err.status === 400) {
          if (err.message.toLowerCase().includes('email')) {
            showFieldError(emailInput, emailError, err.message);
            emailInput.focus();
          } else if (err.message.toLowerCase().includes('username')) {
            showFieldError(usernameInput, usernameError, err.message);
            usernameInput.focus();
          }
        }
      } else {
        showAlert('An unexpected error occurred. Please try again.', 'error');
      }
    } finally {
      isRegistering = false;
    }
  });

  // Step 2: Submit OTP Verification
  otpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isVerifying) return;
    clearAlert();

    const otpCode = otpInput.value.trim();
    if (otpCode.length !== 6) {
      showFieldError(otpInput, otpInputError, 'Please enter the complete 6-digit code.');
      otpInput.focus();
      return;
    }

    isVerifying = true;
    setOtpLoading(true);

    try {
      // Call POST /auth/otp/verify
      await api.verifyOtp(pendingRegistration.email, otpCode, 'registration');

      stopCountdown();
      showAlert('Email verified successfully! Logging you in...', 'success');

      // Complete login and transition to document feed
      await completeLogin(pendingRegistration.email, pendingRegistration.password);

    } catch (err) {
      setOtpLoading(false);
      if (err instanceof ApiError) {
        showFieldError(otpInput, otpInputError, err.message);
        showAlert(err.message, 'error');
        if (err.message.toLowerCase().includes('expired')) {
          markTimerExpired();
        }
      } else {
        showAlert('Verification failed. Please try again.', 'error');
      }
      otpInput.focus();
    } finally {
      isVerifying = false;
    }
  });

  // Step 3: Resend OTP Code
  otpResendBtn.addEventListener('click', async () => {
    if (otpResendBtn.disabled) return;
    clearAlert();
    hideFieldError(otpInput, otpInputError);

    otpResendBtn.disabled = true;
    resendCountdownText.textContent = '(Sending...)';

    try {
      await api.requestOtp(pendingRegistration.email, 'registration');
      showAlert('A new verification code has been dispatched to your email.', 'info');
      otpInput.value = '';
      otpInput.focus();
      startCountdown(30);
    } catch (err) {
      otpResendBtn.disabled = false;
      resendCountdownText.textContent = '';
      const msg = err instanceof ApiError ? err.message : 'Failed to resend code. Please try again.';
      showAlert(msg, 'error');
    }
  });

  // Step 4: Back to Registration Form
  otpBackBtn.addEventListener('click', () => {
    stopCountdown();
    clearAlert();
    otpCard.style.display = 'none';
    registerCard.style.display = 'block';
    usernameInput.focus();
  });

  // Flow State Transitions & Timer
  function showOtpScreen(email) {
    clearAlert();
    registerCard.style.display = 'none';
    otpCard.style.display = 'block';
    otpTargetEmail.textContent = email;
    otpInput.value = '';
    hideFieldError(otpInput, otpInputError);
    startCountdown(30);
    setTimeout(() => otpInput.focus(), 100);
  }

  function startCountdown(seconds) {
    stopCountdown();
    remainingSeconds = seconds;
    otpTimerBadge.classList.remove('is-expired');
    otpResendBtn.disabled = true;

    updateTimerDisplay();

    countdownTimer = setInterval(() => {
      remainingSeconds -= 1;
      updateTimerDisplay();

      if (remainingSeconds <= 0) {
        stopCountdown();
        markTimerExpired();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function updateTimerDisplay() {
    const formatted = remainingSeconds < 10 ? `00:0${remainingSeconds}` : `00:${remainingSeconds}`;
    otpCountdown.textContent = formatted;
    resendCountdownText.textContent = `(${remainingSeconds}s)`;
  }

  function markTimerExpired() {
    otpTimerBadge.classList.add('is-expired');
    otpCountdown.textContent = 'Expired';
    resendCountdownText.textContent = '';
    otpResendBtn.disabled = false;
    showFieldError(otpInput, otpInputError, 'Verification code has expired. Please request a new code.');
  }

  async function completeLogin(email, password) {
    try {
      const tokenData = await api.login(email, password);
      setToken(tokenData.access_token);

      try {
        const userProfile = await api.getMe();
        setUser(userProfile);
      } catch (profileErr) {
        console.warn('Could not cache user profile immediately:', profileErr);
      }

      window.location.href = 'feed.html';
    } catch (loginErr) {
      showAlert('Account verified! Please sign in with your credentials on the login page.', 'success');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1500);
    }
  }

  // UI Utilities
  function isValidEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  }

  function showFieldError(input, errorEl, message) {
    input.classList.add('is-invalid');
    if (errorEl && message) {
      errorEl.textContent = message;
      errorEl.style.display = 'flex';
    }
  }

  function hideFieldError(input, errorEl) {
    input.classList.remove('is-invalid');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  function showAlert(message, type = 'error') {
    const isOtpVisible = otpCard && otpCard.style.display !== 'none';
    const container = isOtpVisible ? (otpAlertContainer || alertContainer) : (alertContainer || otpAlertContainer);
    const msgEl = isOtpVisible ? (otpAlertMessage || alertMessage) : (alertMessage || otpAlertMessage);

    if (container && msgEl) {
      container.className = `alert alert-${type}`;
      msgEl.textContent = message;
      container.style.display = 'flex';
    }
  }

  function clearAlert() {
    if (alertContainer && alertMessage) {
      alertContainer.style.display = 'none';
      alertMessage.textContent = '';
    }
    if (otpAlertContainer && otpAlertMessage) {
      otpAlertContainer.style.display = 'none';
      otpAlertMessage.textContent = '';
    }
  }

  function setRegisterLoading(isLoading) {
    registerSubmitBtn.disabled = isLoading;
    usernameInput.disabled = isLoading;
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;

    if (isLoading) {
      registerSubmitBtn.classList.add('is-loading');
      btnLabel.style.display = 'none';
      btnSpinner.style.display = 'inline-block';
    } else {
      registerSubmitBtn.classList.remove('is-loading');
      btnLabel.style.display = 'inline-block';
      btnLabel.textContent = 'Create Account';
      btnSpinner.style.display = 'none';
    }
  }

  function setOtpLoading(isLoading) {
    otpVerifyBtn.disabled = isLoading;
    otpInput.disabled = isLoading;

    if (isLoading) {
      otpVerifyBtn.classList.add('is-loading');
      otpVerifyLabel.style.display = 'none';
      otpVerifySpinner.style.display = 'inline-block';
    } else {
      otpVerifyBtn.classList.remove('is-loading');
      otpVerifyLabel.style.display = 'inline-block';
      otpVerifyLabel.textContent = 'Verify & Continue';
      otpVerifySpinner.style.display = 'none';
    }
  }

  // Check URL parameters for direct verification flow (e.g. from login redirect)
  const urlParams = new URLSearchParams(window.location.search);
  const verifyParam = urlParams.get('verify');
  const emailParam = urlParams.get('email');
  if (verifyParam === 'true' && emailParam) {
    const cleanEmail = emailParam.trim().toLowerCase();
    pendingRegistration = { username: '', email: cleanEmail, password: '' };
    showOtpScreen(cleanEmail);
    otpResendBtn.disabled = false;
    resendCountdownText.textContent = '';
    showAlert('Please enter your 6-digit verification code below, or click "Resend Code" to request a new code.', 'info');
  }
}

// Ensure initRegisterPage executes regardless of whether DOMContentLoaded already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRegisterPage);
} else {
  initRegisterPage();
}
