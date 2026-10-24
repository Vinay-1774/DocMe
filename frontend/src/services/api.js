/**
 * src/services/api.js
 * Centralized API client for DocMe.
 * Connects to FastAPI backend with unified JWT + HttpOnly refresh cookie handling.
 */

import { getToken, setToken, clearAuth, isTokenExpired } from './auth.js';

function sanitizeApiUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/+$/, '');
}

function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalAddress(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

export function getDefaultApiBaseUrl() {
  let candidate = '';

  // 1. Vite environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (import.meta.env.VITE_DOCME_API_URL) candidate = sanitizeApiUrl(import.meta.env.VITE_DOCME_API_URL);
    else if (import.meta.env.VITE_API_URL) candidate = sanitizeApiUrl(import.meta.env.VITE_API_URL);
  }

  // 2. Window variable overrides
  if (!candidate && typeof window !== 'undefined') {
    if (window.DOCME_API_URL) candidate = sanitizeApiUrl(window.DOCME_API_URL);
    else if (window.RESEARCH_API_URL) candidate = sanitizeApiUrl(window.RESEARCH_API_URL);
  }

  // 3. Document meta tag (<meta name="docme-api-url" content="...">)
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

  // 4. LocalStorage override
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

  if (candidate) {
    if (!isValidHttpUrl(candidate)) {
      const errorMsg = `Invalid backend API URL format: "${candidate}". Must start with http:// or https://.`;
      console.error(`[DocMe] ${errorMsg}`);
      if (isRemoteHost) throw new Error(`[DocMe Configuration Error] ${errorMsg}`);
    } else if (isRemoteHost && isLocalAddress(candidate)) {
      const errorMsg = `Production deployment on "${host}" cannot connect to a local address ("${candidate}"). Please configure DOCME_API_URL with your public Render backend URL.`;
      console.error(`[DocMe] ${errorMsg}`);
      throw new Error(`[DocMe Configuration Error] ${errorMsg}`);
    } else {
      return candidate;
    }
  }

  if (isRemoteHost) {
    const errorMsg = `Backend API URL is not configured for host "${host}". Please configure DOCME_API_URL in your Vercel Project Settings with your Render backend URL.`;
    console.error(`[DocMe] ${errorMsg}`);
    throw new Error(`[DocMe Configuration Error] ${errorMsg}`);
  }

  if (isBrowser) {
    const protocol = window.location.protocol || 'http:';
    const port = window.location.port;
    if (port === '8000') {
      return `${protocol}//${host}${port ? `:${port}` : ''}`;
    }
    return `${protocol}//${host || '127.0.0.1'}:8000`;
  }

  return 'http://127.0.0.1:8000';
}

export const API_BASE_URL = getDefaultApiBaseUrl();

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function parseErrorMessage(data, status) {
  if (!data) {
    if (status === 401) return 'Unauthorized. Please log in.';
    if (status === 403) return 'You are not authorized to perform this action.';
    if (status === 404) return 'Requested resource was not found.';
    if (status === 413) return 'File size exceeds maximum allowed upload limit.';
    if (status >= 500) return 'A server error occurred. Please try again.';
    return `Request failed with status ${status}.`;
  }

  if (typeof data === 'string') return data;
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail) && data.detail.length > 0) {
    const firstErr = data.detail[0];
    if (firstErr.msg) {
      const field = firstErr.loc ? firstErr.loc.slice(-1)[0] : '';
      return field ? `${field}: ${firstErr.msg}` : firstErr.msg;
    }
    return JSON.stringify(data.detail);
  }
  if (data.message) return data.message;
  return `Error (${status})`;
}

// Token Refresh Concurrency Control
let ongoingRefreshPromise = null;

async function requestTokenRefresh() {
  if (ongoingRefreshPromise) {
    return ongoingRefreshPromise;
  }

  ongoingRefreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        let errData = null;
        try {
          errData = await response.json();
        } catch {
          // ignore
        }
        const message = parseErrorMessage(errData, response.status);
        if (response.status === 401 || response.status === 403) {
          clearAuth();
        }
        throw new ApiError(message, response.status, errData);
      }

      const data = await response.json();
      if (!data.access_token) {
        throw new ApiError('Malformed token response from server.', 500);
      }

      setToken(data.access_token);
      return data.access_token;
    } finally {
      ongoingRefreshPromise = null;
    }
  })();

  return ongoingRefreshPromise;
}

export async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    body = null,
    headers = {},
    authRequired = true,
    _isRetry = false,
    ...rest
  } = options;

  let token = getToken();

  if (authRequired && token && !_isRetry && isTokenExpired(token, 10)) {
    try {
      token = await requestTokenRefresh();
    } catch (refreshErr) {
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        throw refreshErr;
      }
    }
  }

  const reqHeaders = { ...headers };
  let reqBody = body;

  if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
    reqHeaders['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  if (authRequired && token) {
    reqHeaders['Authorization'] = `Bearer ${token}`;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: reqBody,
      credentials: 'include',
      ...rest,
    });
  } catch (netErr) {
    throw new ApiError(`Network error: Unable to connect to server. ${netErr.message}`, 0);
  }

  // Handle 401 with single automatic refresh retry
  if (response.status === 401 && authRequired && !_isRetry) {
    try {
      const newToken = await requestTokenRefresh();
      if (newToken) {
        return apiRequest(endpoint, {
          ...options,
          _isRetry: true,
        });
      }
    } catch (refreshErr) {
      if (refreshErr.status === 401 || refreshErr.status === 403) {
        clearAuth();
        throw new ApiError('Your session has expired. Please log in again.', 401);
      }
      throw refreshErr;
    }
  }

  if (!response.ok) {
    let errData = null;
    try {
      errData = await response.json();
    } catch {
      // response might be empty or non-JSON
    }
    const message = parseErrorMessage(errData, response.status);
    throw new ApiError(message, response.status, errData);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export const api = {
  // Authentication
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

  // Discovery & Feed
  async getFeed() {
    return apiRequest('/feed', {
      method: 'GET',
      authRequired: false,
    });
  },

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

  // Profiles & Contributors
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

  // Documents
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
      authRequired: false,
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

  getViewUrl(documentId) {
    return `${API_BASE_URL}/documents/${documentId}/download?inline=true`;
  },

  getDownloadUrl(documentId) {
    return `${API_BASE_URL}/documents/${documentId}/download`;
  },

  async downloadDocument(documentId) {
    const token = getToken();
    const url = `${API_BASE_URL}/documents/${documentId}/download`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
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

  // Comments
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

  // Document AI Q&A
  async chat(documentId, question) {
    return apiRequest(`/documents/${documentId}/chat`, {
      method: 'POST',
      body: { question, stream: false },
      authRequired: true,
    });
  },

  // Real-time SSE streaming Q&A
  async streamChat(documentId, question, { onToken, onSources, onError, onDone }, _isRetry = false) {
    let token = getToken();
    if (token && !_isRetry && isTokenExpired(token, 10)) {
      try {
        token = await requestTokenRefresh();
      } catch (refreshErr) {
        if (refreshErr.status === 401 || refreshErr.status === 403) {
          clearAuth();
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
