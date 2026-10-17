/**
 * shared/api.js
 * Centralized API client for the Research Platform backend.
 * Provides unified request configuration, token injection, and structured error handling.
 */

import { getToken, setToken, clearAuth, isTokenExpired } from './auth.js';
import { ENV_CONFIG } from './env.js';

/**
 * Trims whitespace and strips any trailing slashes from an API URL.
 */
function sanitizeApiUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validates whether a candidate string is a valid HTTP/HTTPS URL.
 */
function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks whether an API URL points to a local address (localhost, 127.0.0.1, 0.0.0.0).
 */
function isLocalAddress(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * Renders a persistent, highly visible configuration alert in the DOM if
 * the backend URL is missing or misconfigured in production.
 */
function displayConfigErrorNotice(message) {
  if (typeof document === 'undefined') return;
  const showNotice = () => {
    if (document.getElementById('docme-config-error-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'docme-config-error-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:999999;background:#b91c1c;color:#ffffff;' +
      'padding:14px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'font-size:14px;font-weight:500;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.25);' +
      'display:flex;align-items:center;justify-content:center;gap:10px;line-height:1.4;';
    banner.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span><strong>Configuration Error:</strong> ${message}</span>
    `;
    if (document.body) {
      document.body.prepend(banner);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.prepend(banner);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showNotice);
  } else {
    showNotice();
  }
}

/**
 * Computes the default API base URL.
 * 1. Checks build-injected environment configuration (ENV_CONFIG.DOCME_API_URL).
 * 2. Checks window overrides (window.DOCME_API_URL / window.RESEARCH_API_URL).
 * 3. Checks HTML document meta tags (<meta name="docme-api-url">).
 * 4. Checks localStorage overrides.
 * 5. In local development (localhost / 127.0.0.1), aligns hostname and defaults to port 8000.
 * 6. In production builds, refuses to silently fall back to localhost/127.0.0.1 and raises
 *    a clear configuration error when the backend URL is missing or invalid.
 */
export function getDefaultApiBaseUrl() {
  let candidate = '';

  // 1. Build-time injected configuration (from Vercel DOCME_API_URL)
  if (typeof ENV_CONFIG !== 'undefined' && ENV_CONFIG?.DOCME_API_URL) {
    candidate = sanitizeApiUrl(ENV_CONFIG.DOCME_API_URL);
  }

  // 2. Window variable overrides
  if (!candidate && typeof window !== 'undefined') {
    if (window.DOCME_API_URL) candidate = sanitizeApiUrl(window.DOCME_API_URL);
    else if (window.RESEARCH_API_URL) candidate = sanitizeApiUrl(window.RESEARCH_API_URL);
  }

  // 3. Document meta tags
  if (!candidate && typeof document !== 'undefined') {
    try {
      const meta =
        document.querySelector('meta[name="docme-api-url"]') ||
        document.querySelector('meta[name="research-api-url"]');
      if (meta && meta.content && meta.content.trim()) {
        candidate = sanitizeApiUrl(meta.content);
      }
    } catch {
      // DOM access restricted
    }
  }

  // 4. LocalStorage overrides
  if (!candidate && typeof window !== 'undefined') {
    try {
      const stored =
        localStorage.getItem('DOCME_API_URL') ||
        localStorage.getItem('RESEARCH_API_URL');
      if (stored && stored.trim()) {
        candidate = sanitizeApiUrl(stored);
      }
    } catch {
      // Storage restricted
    }
  }

  const isBrowser = typeof window !== 'undefined' && Boolean(window.location);
  const host = isBrowser ? window.location.hostname : '';
  const isRemoteHost = Boolean(
    host &&
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    host !== '0.0.0.0'
  );

  // If a candidate URL was found, validate it
  if (candidate) {
    if (!isValidHttpUrl(candidate)) {
      const errorMsg = `Invalid backend API URL format: "${candidate}". Must start with http:// or https://.`;
      console.error(`[DocMe] ${errorMsg}`);
      displayConfigErrorNotice(errorMsg);
      throw new Error(`DocMe Configuration Error: ${errorMsg}`);
    }

    if (isRemoteHost && isLocalAddress(candidate)) {
      const errorMsg =
        `Production deployment on "${host}" cannot connect to a local address ("${candidate}"). ` +
        'Please configure DOCME_API_URL in your Vercel Project Settings with your public Render backend URL.';
      console.error(`[DocMe] ${errorMsg}`);
      displayConfigErrorNotice(errorMsg);
      throw new Error(`DocMe Configuration Error: ${errorMsg}`);
    }

    return candidate;
  }

  // 5. Localhost / local development fallback
  if (isBrowser) {
    const proto = window.location.protocol || 'http:';
    if (window.location.port === '8000') {
      return window.location.origin;
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return `${proto}//${host}:8000`;
    }

    // 6. Production host without configured API URL
    // DO NOT silently fall back to localhost / 127.0.0.1!
    const errorMsg =
      `Backend API URL is not configured for host "${host}". ` +
      'Please configure DOCME_API_URL in your Vercel Project Settings (Environment Variables) ' +
      'with your Render backend URL (e.g., https://your-backend.onrender.com) and redeploy.';
    console.error(`[DocMe] ${errorMsg}`);
    displayConfigErrorNotice(errorMsg);
    throw new Error(`DocMe Configuration Error: ${errorMsg}`);
  }

  // Non-browser / Node.js test environment default
  return 'http://127.0.0.1:8000';
}

// Backend runs on port 8000 by default; allow override via window or localStorage
export const API_BASE_URL = getDefaultApiBaseUrl();

/**
 * Redirects the user to the login page with return URL on genuine session expiration.
 */
function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const currentPath = window.location.pathname;
  if (!currentPath.includes('login.html') && !currentPath.includes('register.html')) {
    const fullPath = currentPath + window.location.search;
    const prefix = currentPath.includes('/pages/') ? '' : 'pages/';
    window.location.href = `${prefix}login.html?session_expired=1&redirect=${encodeURIComponent(fullPath)}`;
  }
}

/**
 * Custom error class capturing HTTP status code, API detail, and raw response.
 */
export class ApiError extends Error {
  constructor(message, status = 0, detail = null, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.data = data;
  }
}

/**
 * Shared in-flight refresh promise to prevent simultaneous duplicate refresh requests.
 */
let refreshPromise = null;

async function requestTokenRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshUrl = `${API_BASE_URL}/refresh`;
        let res;
        try {
          res = await fetch(refreshUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          });
        } catch (netErr) {
          throw new ApiError(
            'Unable to connect to the authentication server for session renewal.',
            0,
            netErr.message
          );
        }

        if (!res.ok) {
          let errorDetail = null;
          try {
            const errData = await res.json();
            errorDetail = errData?.detail;
          } catch {
            // Non-JSON response
          }
          throw new ApiError(
            errorDetail || 'Session refresh rejected',
            res.status,
            errorDetail
          );
        }

        const data = await res.json();
        if (data && data.access_token) {
          setToken(data.access_token);
          return data.access_token;
        }
        throw new ApiError('No access token in refresh response', res.status);
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

/**
 * Parses and formats FastAPI error response bodies into human-readable messages.
 * Handles both plain string details and FastAPI 422 validation error arrays.
 */
function parseErrorMessage(data, status) {
  if (!data) {
    if (status === 401) return 'Invalid email or password. Please try again.';
    if (status === 403) return 'You are not authorized to perform this action.';
    if (status === 404) return 'The requested resource was not found.';
    if (status === 500) return 'Server error. Please try again later.';
    return 'Request failed. Please try again.';
  }

  // Handle standard detail field
  if (data.detail) {
    if (typeof data.detail === 'string') {
      return data.detail;
    }
    // FastAPI validation errors: list of { loc: [...], msg: "...", type: "..." }
    if (Array.isArray(data.detail)) {
      const messages = data.detail.map((err) => {
        const field = Array.isArray(err.loc) ? err.loc[err.loc.length - 1] : '';
        return field ? `${field}: ${err.msg}` : err.msg;
      });
      return messages.join(', ');
    }
    if (typeof data.detail === 'object') {
      return 'An unexpected error occurred. Please try again.';
    }
  }

  if (data.message && typeof data.message === 'string') {
    return data.message;
  }

  return 'Request failed. Please try again.';
}

/**
 * Core HTTP client function for all API communications.
 * Handles automatic access-token injection, transparent single-retry on 401,
 * and concurrent request deduplication.
 *
 * @param {string} endpoint - Relative path (e.g. '/login', '/me')
 * @param {object} options - Fetch options (method, headers, body, authRequired, _isRetry)
 * @returns {Promise<any>}
 */
export async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    authRequired = true,
    _isRetry = false,
    ...restOptions
  } = options;

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const isAuthAuthEndpoint =
    endpoint.includes('/login') ||
    endpoint.includes('/token') ||
    endpoint.includes('/refresh') ||
    endpoint.includes('/logout');

  let token = getToken();

  // If authenticated request and token is expired/near-expiry, proactively refresh before sending
  if (authRequired && !_isRetry && !isAuthAuthEndpoint && token && isTokenExpired(token, 10)) {
    try {
      token = await requestTokenRefresh();
    } catch (refreshErr) {
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        clearAuth();
        redirectToLogin();
        throw refreshErr;
      }
      // On network/5xx error, continue with existing token
    }
  }

  const requestHeaders = {
    Accept: 'application/json',
    ...headers,
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  let finalBody = body;
  // Automatically stringify JSON bodies unless body is already a FormData or string
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    requestHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: finalBody,
      credentials: 'include',
      ...restOptions,
    });
  } catch (networkError) {
    throw new ApiError(
      'Unable to connect to the server. Please check your connection and try again.',
      0,
      networkError.message
    );
  }

  // Handle 401 Unauthorized for authenticated endpoints:
  // Transparently attempt to refresh the session and retry the original request only ONCE
  if (response.status === 401 && authRequired && !_isRetry && !isAuthAuthEndpoint) {
    try {
      const newToken = await requestTokenRefresh();
      if (newToken) {
        return await apiRequest(endpoint, {
          ...options,
          _isRetry: true,
        });
      }
    } catch (refreshErr) {
      // ONLY clear auth and redirect if refresh token is genuinely invalid, revoked, or expired (401/403)
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        clearAuth();
        redirectToLogin();
      }
      throw refreshErr;
    }
  }

  // Parse response body safely
  const contentType = response.headers.get('content-type') || '';
  let responseData = null;
  if (contentType.includes('application/json')) {
    try {
      responseData = await response.json();
    } catch {
      responseData = null;
    }
  } else {
    try {
      responseData = await response.text();
    } catch {
      responseData = null;
    }
  }

  if (!response.ok) {
    const errorMessage = parseErrorMessage(responseData, response.status);
    throw new ApiError(errorMessage, response.status, responseData?.detail, responseData);
  }

  return responseData;
}

/**
 * Authenticated fetch helper for binary streams, file downloads, and custom responses.
 * Performs transparent token refresh and single retry on 401.
 */
export async function apiFetch(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    authRequired = true,
    _isRetry = false,
    ...restOptions
  } = options;

  let token = getToken();

  if (authRequired && !_isRetry && token && isTokenExpired(token, 10)) {
    try {
      token = await requestTokenRefresh();
    } catch (refreshErr) {
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        clearAuth();
        redirectToLogin();
        throw refreshErr;
      }
    }
  }

  const requestHeaders = { ...headers };
  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      credentials: 'include',
      ...restOptions,
    });
  } catch (netErr) {
    throw new ApiError(
      'Unable to connect to the server. Please check your connection and try again.',
      0,
      netErr.message
    );
  }

  if (response.status === 401 && authRequired && !_isRetry) {
    try {
      const newToken = await requestTokenRefresh();
      if (newToken) {
        return await apiFetch(url, {
          ...options,
          _isRetry: true,
        });
      }
    } catch (refreshErr) {
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        clearAuth();
        redirectToLogin();
      }
      throw refreshErr;
    }
  }

  return response;
}

/**
 * Full Research Platform API Client
 */
export const api = {
  // --- Authentication ---
  async login(email, password) {
    return apiRequest('/login', {
      method: 'POST',
      body: { email, password },
      authRequired: false,
    });
  },

  async register(username, email, password) {
    return apiRequest('/register', {
      method: 'POST',
      body: { username, email, password },
      authRequired: false,
    });
  },

  async getMe() {

    return apiRequest('/me', {
      method: 'GET',
      authRequired: true,
    });
  },

  async refreshToken() {
    return requestTokenRefresh();
  },

  async logout() {
    try {
      await fetch(`${API_BASE_URL}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.warn('Backend logout call failed:', err);
    }
    clearAuth();
  },

  async getUserProfile(userId) {
    return apiRequest(`/users/${userId}`, {
      method: 'GET',
      authRequired: false,
    });
  },

  async getContributorDocuments(userId) {
    return apiRequest(`/users/${userId}/documents`, {
      method: 'GET',
      authRequired: false,
    });
  },

  getViewUrl(documentId) {
    return `${API_BASE_URL}/documents/${documentId}/download?inline=true`;
  },

  // --- Discovery & Feed ---
  async getFeed() {
    return apiRequest('/feed', {
      method: 'GET',
      authRequired: false,
    });
  },

  /**
   * Search documents by keyword and pgvector semantic similarity.
   * Accessible by public users (returns public documents) and authenticated users (includes own private documents).
   * @param {string} query - Search query text
   * @param {number} limit - Maximum number of results
   */
  async searchDocuments(query, limit = 10, fetchOptions = {}) {
    const q = encodeURIComponent(query.trim());
    return apiRequest(`/documents/search?q=${q}&limit=${limit}`, {
      method: 'GET',
      authRequired: false,
      ...fetchOptions,
    });
  },

  async getPopularDocuments() {
    return apiRequest('/documents/popular', {
      method: 'GET',
      authRequired: false,
    });
  },

  async getUserRanking() {
    return apiRequest('/users/ranking', {
      method: 'GET',
      authRequired: false,
    });
  },

  // --- Document Management ---
  async getDocuments(filterBy = null) {
    const query = filterBy ? `?filter_by=${encodeURIComponent(filterBy)}` : '';
    return apiRequest(`/documents${query}`, {
      method: 'GET',
      authRequired: true,
    });
  },

  async getDocument(documentId) {
    return apiRequest(`/documents/${documentId}`, {
      method: 'GET',
      authRequired: true,
    });
  },

  async uploadDocument(formData) {
    return apiRequest('/documents', {
      method: 'POST',
      body: formData,
      authRequired: true,
    });
  },

  async updateDocument(documentId, updateData) {
    return apiRequest(`/documents/${documentId}`, {
      method: 'PATCH',
      body: updateData,
      authRequired: true,
    });
  },

  async deleteDocument(documentId) {
    return apiRequest(`/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      authRequired: true,
    });
  },

  async fetchAuthenticated(url, options = {}) {
    return apiFetch(url, options);
  },

  getDownloadUrl(documentId) {
    return `${API_BASE_URL}/documents/${documentId}/download`;
  },

  /**
   * Downloads a document file as a binary Blob with proper Bearer authentication,
   * extracts the original filename safely, and triggers the browser download.
   * Handles HTTP errors before attempting to download.
   * @param {number} documentId
   */
  async downloadDocument(documentId) {
    const url = `${API_BASE_URL}/documents/${documentId}/download`;
    const response = await apiFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*',
      },
      authRequired: true,
    });

    if (!response.ok) {
      let errorDetail = null;
      try {
        const errorData = await response.json();
        errorDetail = parseErrorMessage(errorData, response.status);
      } catch {
        errorDetail = `Download failed with HTTP status ${response.status}.`;
      }
      throw new ApiError(errorDetail, response.status);
    }

    // Safely extract original filename from Content-Disposition header
    let filename = `document-${documentId}`;
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const matchUtf8 = disposition.match(/filename\*=UTF-8''([^;\r\n"']*)/i);
      if (matchUtf8 && matchUtf8[1]) {
        filename = decodeURIComponent(matchUtf8[1]);
      } else {
        const matchPlain = disposition.match(/filename=['"]?([^;\r\n"']*)['"]?/i);
        if (matchPlain && matchPlain[1]) {
          filename = matchPlain[1].trim();
        }
      }
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.href = objectUrl;
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
  },

  // --- Comments ---
  async getComments(documentId) {
    return apiRequest(`/documents/${documentId}/comments`, {
      method: 'GET',
      authRequired: true,
    });
  },

  async createComment(documentId, content) {
    return apiRequest(`/documents/${documentId}/comments`, {
      method: 'POST',
      body: { content },
      authRequired: true,
    });
  },

  // --- Document Chat (LangGraph RAG) ---
  async chat(documentId, question) {
    return apiRequest(`/documents/${documentId}/chat`, {
      method: 'POST',
      body: { question, stream: false },
      authRequired: true,
    });
  },

  /**
   * Real Token Streaming via Server-Sent Events (SSE)
   * Consumes POST /documents/{id}/chat?stream=true with Bearer auth.
   * Seamlessly handles token refresh and single retry on 401.
   */
  async streamChat(documentId, question, { onToken, onSources, onError, onDone }, _isRetry = false) {
    let token = getToken();
    if (token && !_isRetry && isTokenExpired(token, 10)) {
      try {
        token = await requestTokenRefresh();
      } catch (refreshErr) {
        if (refreshErr.status === 401 || refreshErr.status === 403) {
          clearAuth();
          redirectToLogin();
          if (onError) onError('Your session has expired. Please log in again.');
          return;
        }
      }
    }

    const url = `${API_BASE_URL}/documents/${documentId}/chat?stream=true`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ question, stream: true }),
      });

      if (response.status === 401 && !_isRetry) {
        try {
          const refreshedToken = await requestTokenRefresh();
          if (refreshedToken) {
            return this.streamChat(
              documentId,
              question,
              { onToken, onSources, onError, onDone },
              true
            );
          }
        } catch (refreshErr) {
          if (refreshErr.status === 401 || refreshErr.status === 403) {
            clearAuth();
            redirectToLogin();
            if (onError) onError('Your session has expired. Please log in again.');
            return;
          }
        }
      }

      if (!response.ok) {
        let errData = null;
        try {
          errData = await response.json();
        } catch {
          // ignore
        }
        const msg = parseErrorMessage(errData, response.status);
        if (onError) onError(msg);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let doneDispatched = false;
      let hasError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;

          let eventType = 'message';
          let eventData = '';

          const lines = rawEvent.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            }
          }

          try {
            const parsed = eventData ? JSON.parse(eventData) : {};
            if (eventType === 'sources' && onSources) {
              onSources(Array.isArray(parsed) ? parsed : []);
            } else if (eventType === 'message' && onToken) {
              if (parsed.text) onToken(parsed.text);
            } else if (eventType === 'done' && onDone) {
              doneDispatched = true;
              onDone(parsed);
            } else if (eventType === 'error' && onError) {
              hasError = true;
              onError(parsed.detail || 'An error occurred during response generation.');
            }
          } catch (jsonErr) {
            console.warn('Error parsing SSE event data:', jsonErr, eventData);
          }
        }
      }

      if (!doneDispatched && !hasError && onDone) {
        onDone({ status: 'completed' });
      }
    } catch (networkErr) {
      if (onError) onError(networkErr.message);
    }
  },
};
