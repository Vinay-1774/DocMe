
/**
 * frontend/shared/env.js
 * Runtime configuration injected during build/deployment.
 * In local development, DOCME_API_URL is empty by default, allowing api.js
 * to automatically connect to the local development backend (http://127.0.0.1:8000).
 * In production builds (Vercel), this file is populated from process.env.DOCME_API_URL.
 */
export const ENV_CONFIG = Object.freeze({
  DOCME_API_URL: "",
});

if (typeof window !== 'undefined' && ENV_CONFIG.DOCME_API_URL) {
  window.DOCME_API_URL = window.DOCME_API_URL || ENV_CONFIG.DOCME_API_URL;
}
