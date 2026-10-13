/**
 * pages/register.js
 * Controller for the Research Platform Registration Page.
 * Validates account information, registers the user via POST /register,
 * automatically authenticates, and transitions to the document feed.
 */

import { api, ApiError } from '../shared/api.js';
import { setToken, setUser, redirectIfAuthenticated } from '../shared/auth.js';

document.addEventListener('DOMContentLoaded', () => {
  // If already authenticated, redirect to feed
  if (redirectIfAuthenticated('feed.html')) {
    return;
  }

  // DOM Elements
  const form = document.getElementById('register-form');
  const usernameInput = document.getElementById('username');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const usernameError = document.getElementById('username-error');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const alertContainer = document.getElementById('alert-container');
  const alertMessage = document.getElementById('alert-message');
  const submitBtn = document.getElementById('register-submit-btn');
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
  usernameInput.addEventListener('input', () => hideFieldError(usernameInput, usernameError));
  emailInput.addEventListener('input', () => hideFieldError(emailInput, emailError));
  passwordInput.addEventListener('input', () => hideFieldError(passwordInput, passwordError));

  // Form Submission
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
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

    setLoadingState(true);

    try {
      // 1. Call POST /register
      await api.register(username, email, password);

      // 2. Automatically log in to obtain JWT access token
      btnLabel.textContent = 'Authenticating...';
      const tokenData = await api.login(email, password);
      setToken(tokenData.access_token);

      // 3. Cache user profile
      try {
        const userProfile = await api.getMe();
        setUser(userProfile);
      } catch (profileErr) {
        console.warn('Could not fetch user profile immediately:', profileErr);
      }

      btnLabel.textContent = 'Account Created! Redirecting...';
      window.location.href = 'feed.html';

    } catch (err) {
      setLoadingState(false);
      if (err instanceof ApiError) {
        showAlert(err.message, 'error');
        if (err.message.toLowerCase().includes('email')) {
          showFieldError(emailInput, null, null);
          emailInput.focus();
        } else if (err.message.toLowerCase().includes('username')) {
          showFieldError(usernameInput, null, null);
          usernameInput.focus();
        }
      } else {
        showAlert('An unexpected error occurred. Please try again.', 'error');
      }
    }
  });

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
    alertContainer.className = `alert alert-${type}`;
    alertMessage.textContent = message;
    alertContainer.style.display = 'flex';
  }

  function clearErrors() {
    alertContainer.style.display = 'none';
    alertMessage.textContent = '';
    hideFieldError(usernameInput, usernameError);
    hideFieldError(emailInput, emailError);
    hideFieldError(passwordInput, passwordError);
  }

  function setLoadingState(isLoading) {
    submitBtn.disabled = isLoading;
    usernameInput.disabled = isLoading;
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;

    if (isLoading) {
      submitBtn.classList.add('is-loading');
      btnLabel.style.display = 'none';
      btnSpinner.style.display = 'inline-block';
    } else {
      submitBtn.classList.remove('is-loading');
      btnLabel.style.display = 'inline-block';
      btnLabel.textContent = 'Create Account';
      btnSpinner.style.display = 'none';
    }
  }
});
