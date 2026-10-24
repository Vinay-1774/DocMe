/**
 * src/services/auth.js
 * Centralized authentication token management, JWT parsing, and proactive renewal.
 */

const TOKEN_KEY = 'rp_auth_token';
const USER_KEY = 'rp_auth_user';

let refreshTimer = null;

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to read auth token from storage:', err);
    return null;
  }
}

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

export function isTokenExpired(token, bufferSeconds = 60) {
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return true;
  const currentTime = Math.floor(Date.now() / 1000);
  return payload.exp <= (currentTime + bufferSeconds);
}

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

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to read user data from storage:', err);
    return null;
  }
}

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

export function isAuthenticated() {
  const token = getToken();
  return Boolean(token && !isTokenExpired(token, 0));
}

export function scheduleTokenRefresh(token, refreshCallback) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) return;

  const expiresInMs = (payload.exp * 1000) - Date.now();
  const refreshInMs = Math.max(10000, Math.min(expiresInMs - 120000, expiresInMs / 2));

  refreshTimer = setTimeout(async () => {
    try {
      if (typeof refreshCallback === 'function') {
        await refreshCallback();
      }
    } catch (err) {
      console.warn('Proactive background token refresh failed:', err);
    }
  }, refreshInMs);
}
