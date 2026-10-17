/**
 * shared/auth.js
 * Centralized authentication state and session helpers for the Research Platform.
 * Manages JWT tokens, user profiles, and route protection.
 */

const TOKEN_KEY = 'rp_auth_token';
const USER_KEY = 'rp_auth_user';

/**
 * Retrieves the stored JWT access token from localStorage.
 * @returns {string|null}
 */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to read auth token from storage:', err);
    return null;
  }
}

let refreshTimer = null;

/**
 * Parses the base64-encoded payload from a JWT token without external dependencies.
 * @param {string} token
 * @returns {object|null}
 */
export function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Checks whether a JWT token is expired or within the specified buffer window.
 * @param {string} token - Raw JWT string
 * @param {number} bufferSeconds - Buffer before expiration to treat as expired (default 60s)
 * @returns {boolean} True if expired or missing, false if valid
 */
export function isTokenExpired(token, bufferSeconds = 60) {
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return true;
  const currentTime = Math.floor(Date.now() / 1000);
  return payload.exp <= (currentTime + bufferSeconds);
}

/**
 * Schedules a background proactive access token refresh before it expires.
 * @param {string} token
 */
export function scheduleTokenRefresh(token) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return;

  const expiresInMs = (payload.exp * 1000) - Date.now();
  // Attempt refresh 2 minutes (120s) before expiry, or after half the remaining lifetime
  const refreshInMs = Math.max(10000, Math.min(expiresInMs - 120000, expiresInMs / 2));

  refreshTimer = setTimeout(async () => {
    try {
      const { api } = await import('./api.js');
      await api.refreshToken();
    } catch (err) {
      console.warn('Proactive background token refresh failed:', err);
    }
  }, refreshInMs);
}

/**
 * Persists the JWT access token in localStorage and schedules background renewal.
 * @param {string} token
 */
export function setToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      scheduleTokenRefresh(token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }
  } catch (err) {
    console.error('Failed to save auth token to storage:', err);
  }
}

/**
 * Retrieves cached user profile data.
 * @returns {object|null}
 */
export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to read user data from storage:', err);
    return null;
  }
}

/**
 * Persists user profile data.
 * @param {object} user
 */
export function setUser(user) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch (err) {
    console.error('Failed to save user data to storage:', err);
  }
}

/**
 * Clears all authentication credentials and profile data.
 */
export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  } catch (err) {
    console.error('Failed to clear auth from storage:', err);
  }
}

/**
 * Checks whether an active and unexpired authentication token exists.
 * @returns {boolean}
 */
export function isAuthenticated() {
  const token = getToken();
  return Boolean(token && !isTokenExpired(token, 0));
}

/**
 * Guard for protected pages: keeps users logged in across navigation and page reloads.
 * If the current access token is absent or expired, attempts transparent background session
 * refresh using the HttpOnly refresh-token cookie before determining if redirect is needed.
 * Preserves the current page URL for post-login redirect.
 * @returns {Promise<boolean>}
 */
export async function requireAuth() {
  const token = getToken();

  // If token is present and still valid for at least 15 seconds, proceed immediately
  if (token && !isTokenExpired(token, 15)) {
    // Schedule background renewal if not already active
    scheduleTokenRefresh(token);

    // Verify cached user profile matches current token subject to prevent cross-user data leakage
    const payload = parseJwtPayload(token);
    const cachedUser = getUser();
    if (!cachedUser || (payload && String(cachedUser.id) !== String(payload.sub))) {
      try {
        const { api } = await import('./api.js');
        const userProfile = await api.getMe();
        setUser(userProfile);
      } catch {
        // Non-fatal if offline
      }
    }
    return true;
  }

  // Token is either absent or expired/near-expiry: attempt transparent refresh
  try {
    const { api } = await import('./api.js');
    const refreshedToken = await api.refreshToken();
    if (refreshedToken) {
      try {
        const userProfile = await api.getMe();
        setUser(userProfile);
      } catch {
        // Non-fatal
      }
      return true;
    }
  } catch (err) {
    // Check if failure was due to invalid/expired refresh token (HTTP 401/403)
    const isAuthFailure = err?.status === 401 || err?.status === 403;
    if (isAuthFailure || !token) {
      clearAuth();
      const currentPath = window.location.pathname + window.location.search;
      const loginUrl = getRelativePathTo('login.html');
      window.location.href = `${loginUrl}?redirect=${encodeURIComponent(currentPath)}`;
      return false;
    }
    // If it's a temporary network hiccup and the access token hasn't fully expired yet, allow through
    if (token && !isTokenExpired(token, 0)) {
      return true;
    }
  }

  // Cannot establish an active session; redirect to login
  clearAuth();
  const currentPath = window.location.pathname + window.location.search;
  const loginUrl = getRelativePathTo('login.html');
  window.location.href = `${loginUrl}?redirect=${encodeURIComponent(currentPath)}`;
  return false;
}

/**
 * Guard for guest pages (login/register): redirects already authenticated users to the feed.
 * @param {string} destination - Target page (default: 'feed.html')
 */
export function redirectIfAuthenticated(destination = 'feed.html') {
  if (isAuthenticated()) {
    const params = new URLSearchParams(window.location.search);
    const redirectUrl = params.get('redirect') || getRelativePathTo(destination);
    window.location.href = redirectUrl;
    return true;
  }
  return false;
}

/**
 * Logs out the user, revokes the persistent session cookie on the backend, and redirects to login.
 */
export async function logout() {
  try {
    const { api } = await import('./api.js');
    await api.logout();
  } catch (err) {
    console.warn('Backend logout failed:', err);
  }
  clearAuth();
  window.location.href = `${getRelativePathTo('login.html')}?logged_out=1`;
}

/**
 * Computes consistent 1-2 letter initials for a contributor or user name.
 * @param {string} name
 * @returns {string}
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return 'R';
  const clean = name.trim().replace(/^[#@]+/, '');
  if (!clean) return 'R';

  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

/**
 * Returns a consistent, pleasant color gradient for a user's avatar based on name.
 * @param {string} name
 * @returns {string}
 */
export function getAvatarColor(name) {
  const safeName = (name || 'Researcher').trim();
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = (hash << 5) - hash + safeName.charCodeAt(i);
    hash |= 0;
  }
  const gradients = [
    'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)',
    'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
    'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
    'linear-gradient(135deg, #dc2626 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
  ];
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

/**
 * Generates an accessible avatar HTML element with consistent initials and color.
 * @param {string} name
 * @param {string} sizeClass - Optional class, e.g. 'avatar-sm', 'avatar-xs'
 * @returns {string}
 */
export function renderAvatarHtml(name, sizeClass = '') {
  const initials = getInitials(name);
  const color = getAvatarColor(name);
  const safeName = (name || 'Researcher').replace(/"/g, '&quot;');
  return `<div class="user-avatar ${sizeClass}" style="background: ${color};" title="${safeName}" aria-label="${safeName}">${initials}</div>`;
}

/**
 * Displays an accessible logout confirmation modal dialog.
 * Resolves with true if confirmed, false if cancelled.
 * @returns {Promise<boolean>}
 */
export function showLogoutConfirmationModal() {
  return new Promise((resolve) => {
    let modal = document.getElementById('logout-confirm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'logout-confirm-modal';
      modal.className = 'modal-overlay';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'logout-modal-title');
      modal.innerHTML = `
        <div class="modal-dialog logout-modal-dialog" style="max-width: 420px;">
          <div class="modal-header">
            <h2 id="logout-modal-title" class="modal-title" style="font-size: 1.125rem;">Log out?</h2>
            <button type="button" class="modal-close-btn" id="logout-modal-close" aria-label="Close dialog">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="modal-body" style="padding: 1.25rem 1.5rem;">
            <p style="color: var(--text-secondary); line-height: 1.5; font-size: 0.9375rem;">
              Are you sure you want to log out?
            </p>
          </div>
          <div class="modal-footer" style="padding: 1rem 1.5rem; justify-content: flex-end; gap: 0.75rem;">
            <button type="button" id="logout-cancel-btn" class="btn btn-secondary btn-sm">Cancel</button>
            <button type="button" id="logout-confirm-btn" class="btn btn-danger btn-sm">Log out</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    modal.style.display = 'flex';

    const cleanUp = (result) => {
      modal.style.display = 'none';
      window.removeEventListener('keydown', handleKey);
      resolve(result);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        cleanUp(false);
      }
    };

    window.addEventListener('keydown', handleKey);

    const closeBtn = document.getElementById('logout-modal-close');
    const cancelBtn = document.getElementById('logout-cancel-btn');
    const confirmBtn = document.getElementById('logout-confirm-btn');

    closeBtn.onclick = () => cleanUp(false);
    cancelBtn.onclick = () => cleanUp(false);
    modal.onclick = (e) => {
      if (e.target === modal) cleanUp(false);
    };

    confirmBtn.onclick = async () => {
      cleanUp(true);
      await logout();
    };
  });
}

/**
 * Initializes the account menu and wires logout confirmation in the navigation bar.
 */
export function setupUserMenuAndLogout() {
  const user = getUser();
  const navUserBadge = document.getElementById('nav-user-badge');
  const navUsername = document.getElementById('nav-username');
  const navAvatar = document.getElementById('nav-avatar');

  if (user) {
    if (navUsername) navUsername.textContent = user.username || 'Researcher';
    if (navAvatar) {
      navAvatar.textContent = getInitials(user.username);
      navAvatar.style.background = getAvatarColor(user.username);
    }
  }

  // Bind any direct logout button to confirmation modal
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showLogoutConfirmationModal();
    });
  }

  // Setup account dropdown menu on user badge
  if (navUserBadge && !document.getElementById('nav-user-menu-dropdown')) {
    navUserBadge.style.cursor = 'pointer';
    navUserBadge.setAttribute('role', 'button');
    navUserBadge.setAttribute('aria-haspopup', 'true');
    navUserBadge.setAttribute('aria-expanded', 'false');
    navUserBadge.setAttribute('tabindex', '0');

    // Add chevron indicator to badge
    const chevron = document.createElement('span');
    chevron.className = 'nav-user-chevron';
    chevron.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    navUserBadge.appendChild(chevron);

    // Create dropdown menu element
    const dropdown = document.createElement('div');
    dropdown.id = 'nav-user-menu-dropdown';
    dropdown.className = 'user-menu-dropdown';
    dropdown.setAttribute('role', 'menu');
    dropdown.style.display = 'none';

    const usernameStr = user?.username || 'Researcher';
    const emailStr = user?.email || '';

    dropdown.innerHTML = `
      <div class="user-menu-header">
        <div class="user-avatar" style="background: ${getAvatarColor(usernameStr)}; width: 2.25rem; height: 2.25rem; font-size: 0.8125rem;">
          ${getInitials(usernameStr)}
        </div>
        <div class="user-menu-info">
          <span class="user-menu-name">${usernameStr}</span>
          ${emailStr ? `<span class="user-menu-email">${emailStr}</span>` : ''}
        </div>
      </div>
      <div class="user-menu-divider"></div>
      <a href="${getRelativePathTo('profile.html')}" class="user-menu-item" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
        <span>My Workspace &amp; Papers</span>
      </a>
      <a href="${getRelativePathTo('feed.html')}" class="user-menu-item" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
        <span>Scholarly Feed</span>
      </a>
      <div class="user-menu-divider"></div>
      <button type="button" class="user-menu-item user-menu-logout" id="dropdown-logout-action" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        <span>Log out</span>
      </button>
    `;

    // Append dropdown relative to nav-right
    const parentContainer = navUserBadge.parentElement;
    parentContainer.style.position = 'relative';
    parentContainer.appendChild(dropdown);

    const toggleDropdown = (show) => {
      const isVisible = show !== undefined ? show : dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
      navUserBadge.setAttribute('aria-expanded', String(!isVisible));
    };

    navUserBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });

    navUserBadge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !navUserBadge.contains(e.target)) {
        dropdown.style.display = 'none';
        navUserBadge.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('dropdown-logout-action')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';
      navUserBadge.setAttribute('aria-expanded', 'false');
      showLogoutConfirmationModal();
    });
  }

  // Cross-tab logout synchronization & back-forward cache protection
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY && !e.newValue) {
      if (!window.location.pathname.includes('login.html') && !window.location.pathname.includes('register.html')) {
        window.location.href = getRelativePathTo('login.html');
      }
    }
  });

  // Visibility change listener to refresh tokens proactively when tab is resumed
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      const tok = getToken();
      if (tok && isTokenExpired(tok, 120)) {
        try {
          const { api } = await import('./api.js');
          await api.refreshToken();
        } catch {
          // Handled gracefully on next user action
        }
      }
    }
  });
}

/**
 * Helper to compute the relative URL to another page within the pages directory.
 */
function getRelativePathTo(pageName) {
  const path = window.location.pathname;
  if (path.includes('/pages/')) {
    return pageName;
  }
  return `pages/${pageName}`;
}

// Automatically initialize proactive renewal if an active token is already present
const initialToken = getToken();
if (initialToken && !isTokenExpired(initialToken, 0)) {
  scheduleTokenRefresh(initialToken);
}

