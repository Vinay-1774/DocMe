/**
 * shared/api.js
 * Centralized API client for the Research Platform backend.
 * Provides unified request configuration, token injection, and structured error handling.
 */

import { getToken, setToken, clearAuth } from './auth.js';

// Backend runs on port 8001 by default; allow override via window or localStorage
export const API_BASE_URL = window.RESEARCH_API_URL || 'http://127.0.0.1:8001';

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
        const res = await fetch(refreshUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error('Refresh rejected');
        }
        const data = await res.json();
        if (data && data.access_token) {
          setToken(data.access_token);
          return data.access_token;
        }
        throw new Error('No access token in refresh response');
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
 *
 * @param {string} endpoint - Relative path (e.g. '/login', '/me')
 * @param {object} options - Fetch options (method, headers, body, authRequired)
 * @returns {Promise<any>}
 */
export async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    authRequired = true,
    ...restOptions
  } = options;

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const requestHeaders = {
    Accept: 'application/json',
    ...headers,
  };

  // Attach JWT Bearer token whenever available in storage
  let token = getToken();
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
  // Transparently attempt to refresh the session without unwanted user logout
  const isAuthAuthEndpoint = endpoint.includes('/login') || endpoint.includes('/token') || endpoint.includes('/refresh') || endpoint.includes('/logout');
  if (response.status === 401 && authRequired && !isAuthAuthEndpoint) {
    try {
      const newToken = await requestTokenRefresh();
      if (newToken) {
        requestHeaders['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: finalBody,
          credentials: 'include',
          ...restOptions,
        });
      }
    } catch {
      // Refresh failed; session has genuinely expired
      clearAuth();
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/pages/login.html?session_expired=1';
      }
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
    const token = getToken();
    const headers = {
      Accept: 'application/octet-stream, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
      });
    } catch (networkError) {
      throw new ApiError(
        'Unable to connect to the backend server to download the document.',
        0,
        networkError.message
      );
    }

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
   */
  async streamChat(documentId, question, { onToken, onSources, onError, onDone }) {
    const token = getToken();
    const url = `${API_BASE_URL}/documents/${documentId}/chat?stream=true`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, stream: true }),
      });

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
              onError(parsed.detail || 'An error occurred during response generation.');
            }
          } catch (jsonErr) {
            console.warn('Error parsing SSE event data:', jsonErr, eventData);
          }
        }
      }

      if (!doneDispatched && onDone) {
        onDone({ status: 'completed' });
      }
    } catch (networkErr) {
      if (onError) onError(networkErr.message);
    }
  },
};
