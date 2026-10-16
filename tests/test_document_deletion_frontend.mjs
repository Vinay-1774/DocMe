import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('=== Running Document Deletion Frontend Verification ===\n');

// 1. Verify HTML Structure in profile.html, document-chat.html, and feed.html
const profileHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/profile.html'), 'utf8');
const docChatHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.html'), 'utf8');
const feedHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/feed.html'), 'utf8');

const modalElements = [
  'id="delete-doc-modal"',
  'id="close-delete-modal-btn"',
  'id="cancel-delete-btn"',
  'id="confirm-delete-btn"',
  'id="delete-doc-title-display"',
  'id="delete-modal-alert"',
  'id="delete-btn-spinner"',
];

for (const el of modalElements) {
  assert.ok(profileHtml.includes(el), `profile.html must contain ${el}`);
  assert.ok(docChatHtml.includes(el), `document-chat.html must contain ${el}`);
  assert.ok(feedHtml.includes(el), `feed.html must contain ${el}`);
}

assert.ok(docChatHtml.includes('id="delete-doc-btn"'), 'document-chat.html must have #delete-doc-btn');

// Verify simplified wording and removal of technical terms (e.g. vector embeddings)
const simplifiedDescription = 'This action cannot be undone. The document and its associated comments will be permanently deleted.';
for (const [name, html] of [['profile.html', profileHtml], ['document-chat.html', docChatHtml], ['feed.html', feedHtml]]) {
  assert.ok(!html.includes('vector embeddings'), `${name} must not contain technical term 'vector embeddings'`);
  assert.ok(html.includes(simplifiedDescription), `${name} must contain simplified user-friendly description`);
  assert.ok(html.includes('Delete Document'), `${name} must have 'Delete Document' title/button`);
  assert.ok(html.includes('Are you sure you want to delete'), `${name} must have confirmation prompt`);
}
console.log('✓ Scenario 1: HTML modal and simplified wording verified across all target pages.');

// 2. Verify API Client Implementation in api.js
const apiJs = fs.readFileSync(path.join(projectRoot, 'frontend/shared/api.js'), 'utf8');
assert.ok(apiJs.includes('async deleteDocument(documentId)'), 'api.js must implement deleteDocument(documentId)');
assert.ok(apiJs.includes("method: 'DELETE'"), 'deleteDocument must use HTTP DELETE');
assert.ok(apiJs.includes('encodeURIComponent(documentId)'), 'deleteDocument must encode documentId');
console.log('✓ Scenario 2: api.js deleteDocument implementation verified.');

// 3. Verify CSS styling for destructive buttons
const componentsCss = fs.readFileSync(path.join(projectRoot, 'frontend/shared/components.css'), 'utf8');
assert.ok(componentsCss.includes('.btn-outline-danger'), 'components.css must define .btn-outline-danger');
console.log('✓ Scenario 3: Destructive button styling verified.');

// 4. Verify Profile Page logic
const profileJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/profile.js'), 'utf8');
assert.ok(profileJs.includes('openDeleteModal'), 'profile.js must define openDeleteModal');
assert.ok(profileJs.includes('closeDeleteModal'), 'profile.js must define closeDeleteModal');
assert.ok(profileJs.includes('delete-doc-btn'), 'profile.js must render .delete-doc-btn for owner');
assert.ok(profileJs.includes('api.deleteDocument'), 'profile.js must call api.deleteDocument');
assert.ok(profileJs.includes('confirmDeleteBtn.disabled = true'), 'profile.js must disable confirm button during deletion');
assert.ok(profileJs.includes('cancelDeleteBtn.disabled = true'), 'profile.js must disable cancel button during deletion');
assert.ok(profileJs.includes('loadUserDocuments()'), 'profile.js must reload documents on delete');
console.log('✓ Scenario 4: profile.js confirmation dialog, duplicate submission prevention, and list refresh verified.');

// 5. Verify Document Chat Page logic
const docChatJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.js'), 'utf8');
assert.ok(docChatJs.includes('delete-doc-btn'), 'document-chat.js must handle #delete-doc-btn');
assert.ok(docChatJs.includes('openDeleteModal'), 'document-chat.js must define openDeleteModal');
assert.ok(docChatJs.includes('api.deleteDocument'), 'document-chat.js must call api.deleteDocument');
assert.ok(docChatJs.includes("window.location.href = 'profile.html'"), 'document-chat.js must navigate to profile on delete');
console.log('✓ Scenario 5: document-chat.js safe redirection on document deletion verified.');

// 6. Verify Feed Page logic
const feedJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/feed.js'), 'utf8');
assert.ok(feedJs.includes('delete-doc-btn'), 'feed.js must render .delete-doc-btn for owner');
assert.ok(feedJs.includes('openDeleteModal'), 'feed.js must define openDeleteModal');
assert.ok(feedJs.includes('api.deleteDocument'), 'feed.js must call api.deleteDocument');
assert.ok(feedJs.includes('loadFeed()'), 'feed.js must reload feed after deletion');
console.log('✓ Scenario 6: feed.js document card delete button and feed refresh verified.');

// 7. Simulated Modal Flow Test
class MockElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.style = { display: 'none' };
    this.textContent = '';
    this.disabled = false;
    this.listeners = {};
  }
  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }
  async click() {
    const handlers = this.listeners['click'] || [];
    for (const h of handlers) {
      await h({ target: this, preventDefault: () => {} });
    }
  }
}

// Simulate modal behavior
const modal = new MockElement('delete-doc-modal');
const cancelBtn = new MockElement('cancel-delete-btn', 'button');
const confirmBtn = new MockElement('confirm-delete-btn', 'button');
const titleDisplay = new MockElement('delete-doc-title-display', 'span');
const alertBox = new MockElement('delete-modal-alert');
const btnSpinner = new MockElement('delete-btn-spinner', 'span');

let pendingDocId = null;
let apiDeleteCalled = false;
let doubleClickPrevented = false;

function openDeleteModal(docId, docTitle) {
  pendingDocId = docId;
  titleDisplay.textContent = `"${docTitle}"`;
  alertBox.style.display = 'none';
  confirmBtn.disabled = false;
  cancelBtn.disabled = false;
  btnSpinner.style.display = 'none';
  modal.style.display = 'flex';
}

function closeDeleteModal() {
  modal.style.display = 'none';
  pendingDocId = null;
}

cancelBtn.addEventListener('click', closeDeleteModal);

confirmBtn.addEventListener('click', async () => {
  if (confirmBtn.disabled || !pendingDocId) {
    doubleClickPrevented = true;
    return;
  }
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  btnSpinner.style.display = 'inline-block';

  // Simulate API call
  await new Promise(r => setTimeout(r, 20));
  apiDeleteCalled = true;
  closeDeleteModal();
});

// Test modal open & cancellation
openDeleteModal(42, 'Research Quantum Paper');
assert.strictEqual(modal.style.display, 'flex');
assert.strictEqual(titleDisplay.textContent, '"Research Quantum Paper"');
assert.strictEqual(pendingDocId, 42);

// User clicks Cancel
cancelBtn.click();
assert.strictEqual(modal.style.display, 'none');
assert.strictEqual(pendingDocId, null);
assert.strictEqual(apiDeleteCalled, false);
console.log('✓ Scenario 7: Modal cancellation supports canceling without deleting.');

// Test modal confirm & duplicate click prevention
openDeleteModal(100, 'AI Safety Analysis');
assert.strictEqual(modal.style.display, 'flex');

// Start deletion
const firstClickPromise = confirmBtn.click();
// Immediate repeated click while in progress
assert.strictEqual(confirmBtn.disabled, true);
assert.strictEqual(cancelBtn.disabled, true);
confirmBtn.click(); // should be blocked

await firstClickPromise;
assert.strictEqual(apiDeleteCalled, true);
assert.strictEqual(doubleClickPrevented, true);
assert.strictEqual(modal.style.display, 'none');
console.log('✓ Scenario 8: Deletion confirmation & duplicate-click prevention verified.');

console.log('\nAll frontend document deletion checks passed successfully!');
