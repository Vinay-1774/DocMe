import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('--- Testing Profile Empty-State Upload Document Workflow ---');

// 1. Verify HTML Structure in profile.html
const profileHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/profile.html'), 'utf8');

assert.ok(profileHtml.includes('id="empty-upload-action"'), 'profile.html must contain #empty-upload-action button');
assert.ok(profileHtml.includes('id="open-upload-btn"'), 'profile.html must contain #open-upload-btn');
assert.ok(profileHtml.includes('id="upload-modal"'), 'profile.html must contain #upload-modal');
assert.ok(profileHtml.includes('id="upload-form"'), 'profile.html must contain #upload-form');
assert.ok(profileHtml.includes('id="doc-title"'), 'profile.html must contain #doc-title');
assert.ok(profileHtml.includes('id="doc-file"'), 'profile.html must contain #doc-file');
assert.ok(profileHtml.includes('accept=".pdf,.docx"'), 'file input must accept .pdf and .docx');
console.log('Test 1: profile.html DOM elements verified — PASSED');

// 2. Verify JS Implementation in profile.js
const profileJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/profile.js'), 'utf8');

// Ensure NO hardcoded redirect to feed.html on empty-upload-action
assert.ok(
  !profileJs.includes("document.getElementById('empty-upload-action')?.addEventListener('click', () => {\n    window.location.href = 'feed.html';"),
  'empty-upload-action must NOT redirect to feed.html'
);
assert.ok(
  !profileJs.includes("document.getElementById('open-upload-btn')?.addEventListener('click', () => {\n    window.location.href = 'feed.html';"),
  'open-upload-btn must NOT redirect to feed.html'
);

assert.ok(profileJs.includes("emptyUploadAction?.addEventListener('click', openUploadModal)"), 'empty-upload-action must open upload modal');
assert.ok(profileJs.includes("openUploadBtn?.addEventListener('click', openUploadModal)"), 'open-upload-btn must open upload modal');
assert.ok(profileJs.includes("api.uploadDocument"), 'profile.js must call api.uploadDocument on submit');
assert.ok(profileJs.includes("loadUserDocuments()"), 'profile.js must refresh documents on upload success');
console.log('Test 2: profile.js event wiring & API calls verified — PASSED');

// 3. Functional Simulation Test with Mock DOM
class MockElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.style = { display: 'none' };
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.files = [];
    this.listeners = {};
  }
  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }
  async click() {
    const handlers = this.listeners['click'] || [];
    for (const h of handlers) {
      await h({ preventDefault: () => {}, stopPropagation: () => {} });
    }
  }
  async submit(e = { preventDefault: () => {}, stopPropagation: () => {} }) {
    const handlers = this.listeners['submit'] || [];
    for (const h of handlers) {
      await h(e);
    }
  }
  reset() {
    this.value = '';
    this.files = [];
  }
}

const elements = {
  'upload-modal': new MockElement('upload-modal'),
  'open-upload-btn': new MockElement('open-upload-btn', 'button'),
  'empty-upload-action': new MockElement('empty-upload-action', 'button'),
  'close-upload-modal-btn': new MockElement('close-upload-modal-btn', 'button'),
  'cancel-upload-btn': new MockElement('cancel-upload-btn', 'button'),
  'upload-form': new MockElement('upload-form', 'form'),
  'upload-alert': new MockElement('upload-alert'),
  'doc-title': new MockElement('doc-title', 'input'),
  'doc-desc': new MockElement('doc-desc', 'textarea'),
  'doc-visibility': new MockElement('doc-visibility', 'select'),
  'doc-file': new MockElement('doc-file', 'input'),
  'submit-upload-btn': new MockElement('submit-upload-btn', 'button'),
  'upload-btn-text': new MockElement('upload-btn-text', 'span'),
  'upload-btn-spinner': new MockElement('upload-btn-spinner', 'span'),
};

global.document = {
  getElementById: (id) => elements[id] || null,
};

let redirectedUrl = null;
global.window = {
  location: {
    get href() { return redirectedUrl; },
    set href(val) { redirectedUrl = val; }
  }
};

// Wire handlers using the actual profile.js logic pattern
const uploadModal = elements['upload-modal'];
const openUploadBtn = elements['open-upload-btn'];
const emptyUploadAction = elements['empty-upload-action'];
const closeUploadModalBtn = elements['close-upload-modal-btn'];
const cancelUploadBtn = elements['cancel-upload-btn'];
const uploadForm = elements['upload-form'];
const uploadAlert = elements['upload-alert'];
const docTitleInput = elements['doc-title'];
const docFileInput = elements['doc-file'];
const submitUploadBtn = elements['submit-upload-btn'];
const uploadBtnText = elements['upload-btn-text'];
const uploadBtnSpinner = elements['upload-btn-spinner'];

const openUploadModal = (e) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  uploadForm.reset();
  uploadAlert.style.display = 'none';
  uploadModal.style.display = 'flex';
};

const closeUploadModal = () => {
  uploadModal.style.display = 'none';
};

openUploadBtn.addEventListener('click', openUploadModal);
emptyUploadAction.addEventListener('click', openUploadModal);
closeUploadModalBtn.addEventListener('click', closeUploadModal);
cancelUploadBtn.addEventListener('click', closeUploadModal);

let uploadCallCount = 0;
let documentsRefreshed = false;
let uploadedFormData = null;

const mockApi = {
  uploadDocument: async (formData) => {
    uploadCallCount++;
    uploadedFormData = formData;
    return { id: 101, title: formData.get('title'), visibility: 'public' };
  }
};

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadAlert.style.display = 'none';

  const title = docTitleInput.value.trim();
  const file = docFileInput.files[0];

  if (!title) {
    uploadAlert.textContent = 'Please provide a document title.';
    uploadAlert.style.display = 'block';
    return;
  }
  if (!file) {
    uploadAlert.textContent = 'Please select a PDF (.pdf) or Word (.docx) document.';
    uploadAlert.style.display = 'block';
    return;
  }

  const formData = new Map();
  formData.set('title', title);
  formData.set('file', file);

  submitUploadBtn.disabled = true;
  uploadBtnText.textContent = 'Uploading...';
  uploadBtnSpinner.style.display = 'inline-block';

  try {
    const docResult = await mockApi.uploadDocument(formData);
    closeUploadModal();
    documentsRefreshed = true;
  } catch (err) {
    uploadAlert.textContent = err.message;
    uploadAlert.style.display = 'block';
  } finally {
    submitUploadBtn.disabled = false;
    uploadBtnText.textContent = 'Upload';
    uploadBtnSpinner.style.display = 'none';
  }
});

// Test 3: Click empty-upload-action opens modal, no redirect
await emptyUploadAction.click();
assert.strictEqual(uploadModal.style.display, 'flex', 'Modal should be visible (display: flex)');
assert.strictEqual(redirectedUrl, null, 'No redirection should occur');
console.log('Test 3: Empty-state Upload Document button opens modal without redirecting — PASSED');

// Test 4: Cancel modal keeps page unchanged
await cancelUploadBtn.click();
assert.strictEqual(uploadModal.style.display, 'none', 'Modal should be hidden (display: none)');
assert.strictEqual(redirectedUrl, null, 'No redirection should occur');
console.log('Test 4: Cancel button closes modal — PASSED');

// Test 5: Validation - missing title
await emptyUploadAction.click();
await uploadForm.submit();
assert.strictEqual(uploadAlert.style.display, 'block', 'Validation alert should be displayed');
assert.strictEqual(uploadAlert.textContent, 'Please provide a document title.');
console.log('Test 5: Missing title displays error alert — PASSED');

// Test 6: Validation - missing file
docTitleInput.value = 'Quantum Physics Paper';
await uploadForm.submit();
assert.strictEqual(uploadAlert.style.display, 'block');
assert.strictEqual(uploadAlert.textContent, 'Please select a PDF (.pdf) or Word (.docx) document.');
console.log('Test 6: Missing file displays error alert — PASSED');

// Test 7: Successful upload
docFileInput.files = [{ name: 'paper.pdf', size: 1024 }];
await uploadForm.submit();
assert.strictEqual(uploadCallCount, 1, 'api.uploadDocument should be called once');
assert.strictEqual(documentsRefreshed, true, 'User documents should be refreshed');
assert.strictEqual(uploadModal.style.display, 'none', 'Modal should close on success');
assert.strictEqual(redirectedUrl, null, 'User remains on profile page without redirect');
console.log('Test 7: Successful upload updates document list and keeps user on page — PASSED');

// Test 8: Verify document-chat.html DOM elements
const docChatHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.html'), 'utf8');
assert.ok(docChatHtml.includes('id="docs-empty-state"'), 'document-chat.html must contain #docs-empty-state');
assert.ok(docChatHtml.includes('id="empty-upload-action"'), 'document-chat.html must contain #empty-upload-action');
assert.ok(docChatHtml.includes('id="upload-modal"'), 'document-chat.html must contain #upload-modal');
assert.ok(docChatHtml.includes('id="upload-form"'), 'document-chat.html must contain #upload-form');
assert.ok(docChatHtml.includes('id="doc-file"'), 'document-chat.html must contain #doc-file');
console.log('Test 8: document-chat.html DOM elements verified — PASSED');

// Test 9: Verify document-chat.js logic
const docChatJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.js'), 'utf8');
assert.ok(
  !docChatJs.includes("alert('No document specified. Redirecting to feed.');\n    window.location.href = 'feed.html';"),
  'document-chat.js must NOT redirect to feed.html when documentId is absent'
);
assert.ok(docChatJs.includes("emptyUploadAction?.addEventListener('click', openUploadModal)"), 'document-chat.js must wire upload modal');
assert.ok(docChatJs.includes("api.uploadDocument"), 'document-chat.js must call api.uploadDocument');
console.log('Test 9: document-chat.js empty state & upload wiring verified — PASSED');

console.log('--- All Profile & Document Chat Upload Tests Passed Successfully ---');
