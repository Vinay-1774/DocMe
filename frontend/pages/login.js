/**
 * pages/login.js
 * Controller for the Research Platform Login Page.
 * Handles input validation, authentication dispatch, session management, and redirection.
 */

import { api, ApiError } from '../shared/api.js';
import { setToken, setUser, redirectIfAuthenticated } from '../shared/auth.js';

async function initLoginPage() {
  // 1. If user is already authenticated with a valid token, redirect immediately to feed
  if (redirectIfAuthenticated('feed.html')) {
    return;
  }

  // Check URL query parameters for notifications
  const params = new URLSearchParams(window.location.search);
  const isSessionExpired = Boolean(params.get('session_expired'));
  const isLoggedOut = Boolean(params.get('logged_out'));

  if (isSessionExpired) {
    showAlert('Your session has expired. Please sign in again.', 'info');
  } else if (params.get('registered')) {
    showAlert('Account created successfully! Please sign in with your credentials.', 'success');
  } else if (!isLoggedOut) {
    // If arriving without an explicit logout or expiration, attempt transparent session recovery
    try {
      const refreshedToken = await api.refreshToken();
      if (refreshedToken) {
        const redirectUrl = params.get('redirect') || 'feed.html';
        window.location.href = redirectUrl;
        return;
      }
    } catch {
      // No active session cookie; display login form
    }
  }

  // DOM Elements
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const alertContainer = document.getElementById('alert-container');
  const alertMessage = document.getElementById('alert-message');
  const submitBtn = document.getElementById('login-submit-btn');
  const btnLabel = document.getElementById('btn-label');
  const btnSpinner = document.getElementById('btn-spinner');
  const passwordToggleBtn = document.getElementById('password-toggle-btn');
  const eyeIcon = document.getElementById('eye-icon');
  const eyeOffIcon = document.getElementById('eye-off-icon');

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
  emailInput.addEventListener('input', () => {
    hideFieldError(emailInput, emailError);
  });

  passwordInput.addEventListener('input', () => {
    hideFieldError(passwordInput, passwordError);
  });

  // Form Submission
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Client-side Validation
    let isValid = true;

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
    }

    if (!isValid) {
      return;
    }

    // Set Loading State
    setLoadingState(true);

    try {
      // 1. Submit credentials to backend POST /login
      const tokenData = await api.login(email, password);
      
      // 2. Persist access token in localStorage
      setToken(tokenData.access_token);

      // 3. Fetch authenticated user profile via GET /me
      try {
        const userProfile = await api.getMe();
        setUser(userProfile);
      } catch (profileErr) {
        console.warn('Could not fetch user profile immediately after login:', profileErr);
      }

      // 4. Show success feedback on submit button
      btnLabel.textContent = 'Redirecting...';

      // 5. Redirect user to destination or feed
      const redirectUrl = params.get('redirect') || 'feed.html';
      window.location.href = redirectUrl;

    } catch (err) {
      setLoadingState(false);

      if (err instanceof ApiError) {
        showAlert(err.message, 'error');
        if (err.status === 401) {
          showFieldError(emailInput, null, null);
          showFieldError(passwordInput, null, null);
          passwordInput.focus();
        }
      } else {
        showAlert('An unexpected error occurred. Please try again.', 'error');
      }
    }
  });

  // Helper Functions
  function isValidEmail(str) {
    // Standard RFC5322-compatible basic email pattern
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
    alertContainer.className = `alert alert-${type}`;
    alertMessage.textContent = message;
    alertContainer.style.display = 'flex';
  }

  function clearErrors() {
    alertContainer.style.display = 'none';
    alertMessage.textContent = '';
    hideFieldError(emailInput, emailError);
    hideFieldError(passwordInput, passwordError);
  }

  function setLoadingState(isLoading) {
    submitBtn.disabled = isLoading;
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;

    if (isLoading) {
      submitBtn.classList.add('is-loading');
      btnLabel.style.display = 'none';
      btnSpinner.style.display = 'inline-block';
    } else {
      submitBtn.classList.remove('is-loading');
      btnLabel.style.display = 'inline-block';
      btnLabel.textContent = 'Sign In';
      btnSpinner.style.display = 'none';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginPage);
} else {
  initLoginPage();
}
