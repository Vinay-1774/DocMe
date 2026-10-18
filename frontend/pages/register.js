/**
 * pages/register.js
 * Controller for the Research Platform Registration Flow.
 * Validates user input, calls the registration API, and navigates to login.
 */

import { api, ApiError } from '../shared/api.js';
import { redirectIfAuthenticated } from '../shared/auth.js';
import { isValidEmail } from '../shared/format.js';

function initRegisterPage() {
  // If already authenticated, redirect to feed
  if (redirectIfAuthenticated('feed.html')) {
    return;
  }

  // DOM Elements
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
  const alertContainer = document.getElementById('alert-container');
  const alertMessage = document.getElementById('alert-message');

  let isRegistering = false;

  // Toggle Password Visibility
  if (passwordToggleBtn) {
    passwordToggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      if (eyeIcon) eyeIcon.style.display = isPassword ? 'none' : 'block';
      if (eyeOffIcon) eyeOffIcon.style.display = isPassword ? 'block' : 'none';
      passwordToggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  // Real-time input error clearing
  if (usernameInput) {
    usernameInput.addEventListener('input', () => hideFieldError(usernameInput, usernameError));
  }
  if (emailInput) {
    emailInput.addEventListener('input', () => hideFieldError(emailInput, emailError));
  }
  if (passwordInput) {
    passwordInput.addEventListener('input', () => hideFieldError(passwordInput, passwordError));
  }

  // Form Submission
  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isRegistering) return;
      clearAlert();

      const username = usernameInput ? usernameInput.value.trim() : '';
      const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
      const password = passwordInput ? passwordInput.value : '';

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
        await api.register(username, email, password);

        // Account created successfully - notify user and redirect to login
        showAlert('Account created successfully! Redirecting to login...', 'success');
        setTimeout(() => {
          window.location.href = 'login.html?registered=true';
        }, 1200);

      } catch (err) {
        setRegisterLoading(false);
        if (err instanceof ApiError) {
          showAlert(err.message, 'error');
          if (err.status === 400) {
            if (err.message.toLowerCase().includes('email')) {
              showFieldError(emailInput, emailError, err.message);
              if (emailInput) emailInput.focus();
            } else if (err.message.toLowerCase().includes('username')) {
              showFieldError(usernameInput, usernameError, err.message);
              if (usernameInput) usernameInput.focus();
            }
          }
        } else {
          showAlert('An unexpected error occurred. Please try again.', 'error');
        }
      } finally {
        isRegistering = false;
      }
    });
  }

  // UI Utilities

  function showFieldError(input, errorEl, message) {
    if (input) input.classList.add('is-invalid');
    if (errorEl && message) {
      errorEl.textContent = message;
      errorEl.style.display = 'flex';
    }
  }

  function hideFieldError(input, errorEl) {
    if (input) input.classList.remove('is-invalid');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  function showAlert(message, type = 'error') {
    if (alertContainer && alertMessage) {
      alertContainer.className = `alert alert-${type}`;
      alertMessage.textContent = message;
      alertContainer.style.display = 'flex';
    }
  }

  function clearAlert() {
    if (alertContainer && alertMessage) {
      alertContainer.style.display = 'none';
      alertMessage.textContent = '';
    }
  }

  function setRegisterLoading(isLoading) {
    if (registerSubmitBtn) registerSubmitBtn.disabled = isLoading;
    if (usernameInput) usernameInput.disabled = isLoading;
    if (emailInput) emailInput.disabled = isLoading;
    if (passwordInput) passwordInput.disabled = isLoading;

    if (isLoading) {
      if (registerSubmitBtn) registerSubmitBtn.classList.add('is-loading');
      if (btnLabel) btnLabel.style.display = 'none';
      if (btnSpinner) btnSpinner.style.display = 'inline-block';
    } else {
      if (registerSubmitBtn) registerSubmitBtn.classList.remove('is-loading');
      if (btnLabel) {
        btnLabel.style.display = 'inline-block';
        btnLabel.textContent = 'Create Account';
      }
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRegisterPage);
} else {
  initRegisterPage();
}
