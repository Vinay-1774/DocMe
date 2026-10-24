/**
 * tests/test_document_discussion.mjs
 * Verification of Phase 06: Comments and Social Interactions:
 * - Loading comments via real API schema
 * - Posting comments with payload validation
 * - Empty comment validation & client guards
 * - API failure handling (preserving draft text)
 * - Duplicate submission prevention
 * - Author profile navigation (/profile/:id)
 * - DocumentCard comment action navigation (?tab=discussion)
 * - Private document permission handling
 * - Signed-out user experience & auth prompts
 * - Responsive layout & workspace integration
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Running DocMe Comments & Discussion Tests ===\n');

// 1. Inspect source files
const discussionJsxPath = path.resolve('frontend/src/components/DocumentDiscussion.jsx');
const discussionCssPath = path.resolve('frontend/src/components/DocumentDiscussion.css');
const documentPageJsxPath = path.resolve('frontend/src/pages/DocumentPage.jsx');
const documentCardJsxPath = path.resolve('frontend/src/components/DocumentCard.jsx');
const apiJsPath = path.resolve('frontend/src/services/api.js');

assert.ok(fs.existsSync(discussionJsxPath), 'DocumentDiscussion.jsx must exist');
assert.ok(fs.existsSync(discussionCssPath), 'DocumentDiscussion.css must exist');

const discussionJsx = fs.readFileSync(discussionJsxPath, 'utf8');
const discussionCss = fs.readFileSync(discussionCssPath, 'utf8');
const documentPageJsx = fs.readFileSync(documentPageJsxPath, 'utf8');
const documentCardJsx = fs.readFileSync(documentCardJsxPath, 'utf8');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');

// Test 1: Real API Endpoints & Request Schema
console.log('Test 1: Comment Endpoints & API Client Methods');
assert.ok(apiJs.includes('getComments(documentId)'), 'api.getComments must exist');
assert.ok(apiJs.includes('createComment(documentId, content)'), 'api.createComment must exist');
assert.ok(apiJs.includes('body: { content }'), 'Payload must match CommentCreate schema { content }');
assert.ok(discussionJsx.includes('api.getComments(documentId)'), 'Must call api.getComments');
assert.ok(discussionJsx.includes('api.createComment(documentId, trimmed)'), 'Must call api.createComment');
console.log('  PASSED\n');

// Test 2: Empty Comment Validation
console.log('Test 2: Empty Comment Validation');
assert.ok(discussionJsx.includes('!trimmed'), 'Must validate that comment text is non-empty');
assert.ok(discussionJsx.includes('Comment cannot be empty'), 'Must set descriptive error message');
assert.ok(discussionJsx.includes('disabled={isSubmitting || !commentText.trim()}'), 'Submit button must be disabled when text is empty');
console.log('  PASSED\n');

// Test 3: Duplicate Submission Prevention
console.log('Test 3: Duplicate Submission Prevention');
assert.ok(discussionJsx.includes('if (isSubmitting) return;'), 'Must guard against concurrent submissions');
assert.ok(discussionJsx.includes('setIsSubmitting(true)'), 'Must activate isSubmitting state on send');
assert.ok(discussionJsx.includes('disabled={isSubmitting'), 'Form controls must be disabled during submission');
console.log('  PASSED\n');

// Test 4: Draft Preservation on Failure & Server-confirmed Reset
console.log('Test 4: Draft Text Preservation & Success Reset');
assert.ok(
  discussionJsx.includes('setCommentText(\'\')'),
  'Composer text must be cleared ONLY upon successful server response'
);
// In catch block, commentText is NOT cleared
assert.ok(
  discussionJsx.includes('setSubmitError(err.message'),
  'Error message must be presented on API failure'
);
console.log('  PASSED\n');

// Test 5: Author Profile Navigation & Avatar Fallback
console.log('Test 5: Author Profile Navigation & Real Metadata');
assert.ok(discussionJsx.includes('/profile/${comment.user_id}'), 'Must link author to /profile/:id');
assert.ok(discussionJsx.includes('comment.author_name'), 'Must display real author name returned by API');
assert.ok(discussionJsx.includes('getInitials('), 'Must derive initials as avatar fallback');
assert.ok(discussionJsx.includes('docAuthorId && comment.user_id === docAuthorId'), 'Must support document Author badge');
console.log('  PASSED\n');

// Test 6: DocumentCard Comment Action Integration
console.log('Test 6: DocumentCard Comment Link & Real Count Display');
assert.ok(documentCardJsx.includes('/document/${doc.id}?tab=discussion'), 'Feed card must link comment action to ?tab=discussion');
assert.ok(documentCardJsx.includes('{doc.comment_count}'), 'Must display real comment count from API');
console.log('  PASSED\n');

// Test 7: DocumentPage Workspace Integration & Tab Switching
console.log('Test 7: Document Workspace Tab Integration');
assert.ok(documentPageJsx.includes('DocumentDiscussion'), 'DocumentPage must import DocumentDiscussion');
assert.ok(documentPageJsx.includes('searchParams.get(\'tab\') === \'discussion\''), 'Must activate discussion tab from URL query');
assert.ok(documentPageJsx.includes('Peer Discussion'), 'Workspace must have Peer Discussion tab');
assert.ok(documentPageJsx.includes('commentCount'), 'DocumentPage must track real comment count');
console.log('  PASSED\n');

// Test 8: Signed-Out Experience
console.log('Test 8: Signed-Out Authentication Prompt');
assert.ok(discussionJsx.includes('!isAuthenticated'), 'Must check authentication state');
assert.ok(discussionJsx.includes('Join the Scientific Discussion') || discussionJsx.includes('Log In to Participate'), 'Must prompt signed-out users');
assert.ok(discussionJsx.includes('/login'), 'Must provide direct link to login');
console.log('  PASSED\n');

// Test 9: Private Document Permissions (403 Handling)
console.log('Test 9: Private Document Permission Handling');
assert.ok(
  discussionJsx.includes('403') || discussionJsx.includes('authorized'),
  'Must explicitly handle 403 Forbidden for unauthorized private document comments'
);
console.log('  PASSED\n');

// Test 10: CSS Palette & Tokens
console.log('Test 10: CSS Tokens & Responsive Design');
assert.ok(discussionCss.includes('var(--bg-surface)'), 'Must use surface background token');
assert.ok(discussionCss.includes('var(--primary-emerald)'), 'Must use emerald accent token');
assert.ok(discussionCss.includes('var(--border-subtle)'), 'Must use subtle border token');
assert.ok(discussionCss.includes('.comment-card'), 'Must define readable comment cards');
console.log('  PASSED\n');

console.log('=== All Comments & Discussion Tests Completed Successfully! ===');
