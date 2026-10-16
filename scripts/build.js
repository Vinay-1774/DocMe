#!/usr/bin/env node

/**
 * scripts/build.js
 * Deployment and build-time configuration injector for DocMe.
 * 
 * Safely makes the Vercel environment variable DOCME_API_URL (or RESEARCH_API_URL)
 * available to vanilla JavaScript in the browser by:
 * 1. Injecting it into frontend/shared/env.js (ES module configuration)
 * 2. Synchronizing <meta name="docme-api-url" content="..."> in all HTML pages
 * 
 * In production builds (Vercel or --prod), it validates that the Render backend URL
 * is configured and fails fast with a clear explanation if missing or invalid.
 * In local development, it preserves the localhost backend fallback.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const frontendDir = path.join(projectRoot, 'frontend');
const envJsPath = path.join(frontendDir, 'shared', 'env.js');

const htmlFiles = [
  path.join(frontendDir, 'index.html'),
  path.join(frontendDir, 'pages', 'login.html'),
  path.join(frontendDir, 'pages', 'register.html'),
  path.join(frontendDir, 'pages', 'feed.html'),
  path.join(frontendDir, 'pages', 'profile.html'),
  path.join(frontendDir, 'pages', 'document-chat.html'),
];

const isClean = process.argv.includes('--clean') || process.argv.includes('--reset');
const isProd = Boolean(
  process.env.VERCEL ||
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--prod')
);

// Read API URL strictly from DOCME_API_URL or RESEARCH_API_URL
// NEVER read or expose any backend secrets (DB, Gemini, JWT, OTP, SMTP)
const rawApiUrl = (process.env.DOCME_API_URL || process.env.RESEARCH_API_URL || '').trim();

function validateApiUrl(url, enforceProduction) {
  if (!url) {
    if (enforceProduction) {
      console.error('\n' + '='.repeat(80));
      console.error('[DocMe Build Error] Missing Production Backend API URL');
      console.error('='.repeat(80));
      console.error('The environment variable DOCME_API_URL (or RESEARCH_API_URL) is required');
      console.error('for production deployments on Vercel, but was not found.');
      console.error('\nTo resolve this:');
      console.error('  1. In the Vercel Dashboard, go to: Project Settings -> Environment Variables');
      console.error('  2. Add:');
      console.error('       Key:   DOCME_API_URL');
      console.error('       Value: https://<your-render-service>.onrender.com');
      console.error('       Environments: Production, Preview (and Development if needed)');
      console.error('  3. Redeploy your project.');
      console.error('='.repeat(80) + '\n');
      process.exit(1);
    }
    return '';
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`\n[DocMe Build Error] Invalid URL format for DOCME_API_URL: "${url}"`);
    console.error('Expected a valid URL starting with https:// or http://');
    process.exit(1);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.error(`\n[DocMe Build Error] Invalid protocol in DOCME_API_URL: "${url}"`);
    console.error('Protocol must be http:// or https://');
    process.exit(1);
  }

  if (enforceProduction) {
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0') {
      console.error('\n' + '='.repeat(80));
      console.error('[DocMe Build Error] Invalid Production Backend URL (Localhost Detected)');
      console.error('='.repeat(80));
      console.error(`DOCME_API_URL is configured as "${url}".`);
      console.error('Production builds deployed to Vercel cannot connect to localhost or 127.0.0.1.');
      console.error('Please configure DOCME_API_URL with your public Render backend URL');
      console.error('(e.g., https://your-backend.onrender.com).');
      console.error('='.repeat(80) + '\n');
      process.exit(1);
    }
  }

  return url.replace(/\/+$/, '');
}

function updateEnvJs(apiUrl) {
  const content = `/**
 * frontend/shared/env.js
 * Runtime configuration injected during build/deployment.
 * In local development, DOCME_API_URL is empty by default, allowing api.js
 * to automatically connect to the local development backend (http://127.0.0.1:8000).
 * In production builds (Vercel), this file is populated from process.env.DOCME_API_URL.
 */
export const ENV_CONFIG = Object.freeze({
  DOCME_API_URL: ${JSON.stringify(apiUrl)},
});

if (typeof window !== 'undefined' && ENV_CONFIG.DOCME_API_URL) {
  window.DOCME_API_URL = window.DOCME_API_URL || ENV_CONFIG.DOCME_API_URL;
}
`;
  fs.writeFileSync(envJsPath, content, 'utf8');
}

function updateHtmlFiles(apiUrl) {
  for (const filePath of htmlFiles) {
    if (!fs.existsSync(filePath)) continue;
    let html = fs.readFileSync(filePath, 'utf8');

    const metaTagRegex = /<meta\s+name=["'](?:docme-api-url|research-api-url)["']\s+content=["'][^"']*["']\s*\/?>/i;
    const newMetaTag = `<meta name="docme-api-url" content="${apiUrl}">`;

    if (metaTagRegex.test(html)) {
      html = html.replace(metaTagRegex, newMetaTag);
    } else {
      // Inject after <meta name="viewport" ...> or inside <head>
      const viewportRegex = /(<meta\s+name=["']viewport["'][^>]*>)/i;
      if (viewportRegex.test(html)) {
        html = html.replace(viewportRegex, `$1\n  ${newMetaTag}`);
      } else {
        html = html.replace(/<head>/i, `<head>\n  ${newMetaTag}`);
      }
    }

    fs.writeFileSync(filePath, html, 'utf8');
  }
}

function main() {
  console.log('--- DocMe Frontend Build & Configuration ---');
  if (isClean) {
    console.log('[DocMe Build] Cleaning build configuration (resetting to local development defaults)...');
    updateEnvJs('');
    updateHtmlFiles('');
    console.log('✓ Configuration reset complete.');
    return;
  }

  const validatedUrl = validateApiUrl(rawApiUrl, isProd);

  if (validatedUrl) {
    console.log(`[DocMe Build] Configuring backend API URL: ${validatedUrl}`);
  } else {
    console.log('[DocMe Build] Local development mode: DOCME_API_URL is empty; defaulting to localhost:8000 fallback.');
  }

  updateEnvJs(validatedUrl);
  updateHtmlFiles(validatedUrl);

  console.log(`✓ Updated ${path.relative(projectRoot, envJsPath)}`);
  for (const file of htmlFiles) {
    console.log(`✓ Updated ${path.relative(projectRoot, file)}`);
  }
  console.log('--- DocMe Frontend Build Completed Successfully ---');
}

main();
