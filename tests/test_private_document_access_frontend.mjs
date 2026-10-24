import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Running DocMe Private Document Access Frontend Regression Tests ===\n');

// 1. Inspect api.js source code to ensure proper token handling
console.log('Test 1: apiRequest passes Bearer token even when authRequired is false');
const apiJsPath = path.join(rootDir, 'frontend/src/services/api.js');
const apiJsContent = fs.readFileSync(apiJsPath, 'utf-8');

// Ensure token is attached whenever present and not anonymous
assert.ok(
  apiJsContent.includes("if (!anonymous && token) {\n    reqHeaders['Authorization'] = `Bearer ${token}`;"),
  'apiRequest must attach Authorization header whenever token is present and not explicitly anonymous'
);
assert.ok(
  !apiJsContent.includes("if (authRequired && token) {\n    reqHeaders['Authorization']"),
  'apiRequest must not restrict Authorization header only to authRequired: true'
);
console.log('  PASSED\n');

// 2. Proactive and reactive token refresh in apiRequest
console.log('Test 2: Token expiration check & 401 refresh retry in apiRequest');
assert.ok(
  apiJsContent.includes('isTokenExpired(token, 10)'),
  'apiRequest must check for token expiration before request execution'
);
assert.ok(
  apiJsContent.includes('response.status === 401 && !_isRetry && !anonymous && (token || authRequired)'),
  'apiRequest must retry on 401 if a token was provided or auth was required'
);
assert.ok(
  apiJsContent.includes("authRequired: false,\n      anonymous: true"),
  'login and register must specify anonymous: true'
);
console.log('  PASSED\n');

// 3. Centralized authorized file fetching via api.fetchDocumentFile
console.log('Test 3: Centralized authorized file fetching via api.fetchDocumentFile');
assert.ok(
  apiJsContent.includes('async fetchDocumentFile(documentId,'),
  'api object must expose fetchDocumentFile method'
);
assert.ok(
  apiJsContent.includes('downloadDocument(documentId) {\n    const response = await this.fetchDocumentFile('),
  'downloadDocument must delegate to fetchDocumentFile'
);
console.log('  PASSED\n');

// 4. PdfViewer integration with api.fetchDocumentFile
console.log('Test 4: PdfViewer uses api.fetchDocumentFile for PDF and DOCX loading');
const pdfViewerPath = path.join(rootDir, 'frontend/src/components/PdfViewer.jsx');
const pdfViewerContent = fs.readFileSync(pdfViewerPath, 'utf-8');

assert.ok(
  pdfViewerContent.includes('const response = await api.fetchDocumentFile(documentId, {\n          inline: true,\n          accept: \'application/pdf'),
  'PdfViewer loadPdf must use api.fetchDocumentFile with inline: true and abort signal'
);
assert.ok(
  pdfViewerContent.includes('const response = await api.fetchDocumentFile(documentId, {\n          inline: true,\n          accept: \'application/vnd.openxmlformats'),
  'PdfViewer loadDocx must use api.fetchDocumentFile with inline: true and abort signal'
);
console.log('  PASSED\n');

// 5. DocumentPage error classification & accurate messaging
console.log('Test 5: DocumentPage differentiates 401, 403, 404, and network/server errors');
const documentPagePath = path.join(rootDir, 'frontend/src/pages/DocumentPage.jsx');
const documentPageContent = fs.readFileSync(documentPagePath, 'utf-8');

// Check 401 handling
assert.ok(
  documentPageContent.includes("status: 401,\n          title: 'Sign In Required'"),
  'DocumentPage must classify 401 as Sign In Required'
);

// Check 403 handling
assert.ok(
  documentPageContent.includes("status: 403,\n          title: 'Access Restricted'"),
  'DocumentPage must classify 403 as Access Restricted'
);

// Check 404 handling
assert.ok(
  documentPageContent.includes("status: 404,\n          title: 'Document Not Found'"),
  'DocumentPage must classify 404 as Document Not Found'
);

// Check network/server error handling
assert.ok(
  documentPageContent.includes("title: 'Unable to Load Document'"),
  'DocumentPage must classify network/server errors as Unable to Load Document'
);

// Check retry button for network/server errors
assert.ok(
  documentPageContent.includes('onClick={fetchDoc}') && documentPageContent.includes('Try Again'),
  'DocumentPage must provide a Try Again button for network or 5xx server errors'
);

// Check login prompt only shown on 401 when unauthenticated
assert.ok(
  documentPageContent.includes('errorState.status === 401 && !isAuthenticated'),
  'DocumentPage must only show Sign In button on 401 when user is not authenticated'
);

console.log('  PASSED\n');

console.log('=== All DocMe Private Document Access Frontend Tests Passed! ===\n');
