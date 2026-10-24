/**
 * tests/test_document_topics_frontend.mjs
 * Verification of Real Document Topic Categorization in DocMe frontend:
 * 1. Removal of hardcoded topic lists (DEFAULT_TOPICS) from frontend
 * 2. Topic selection field in PublishModal.jsx with max 5 limit & clear state
 * 3. Topic persistence via FormData in PublishModal
 * 4. Dynamic topics loading with counts and Uncategorized support in SidebarLeft.jsx
 * 5. FeedPage integration passing topics to backend without title-derived fake filtering
 * 6. DocumentCard using real database topics and Uncategorized fallback
 * 7. Centralized api.js topic methods
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Running DocMe Document Topics Frontend Regression Tests ===\n');

const sidebarJsxPath = path.resolve('frontend/src/components/SidebarLeft.jsx');
const sidebarCssPath = path.resolve('frontend/src/components/SidebarLeft.css');
const publishJsxPath = path.resolve('frontend/src/components/PublishModal.jsx');
const publishCssPath = path.resolve('frontend/src/components/PublishModal.css');
const cardJsxPath = path.resolve('frontend/src/components/DocumentCard.jsx');
const cardCssPath = path.resolve('frontend/src/components/DocumentCard.css');
const feedJsxPath = path.resolve('frontend/src/pages/FeedPage.jsx');
const apiJsPath = path.resolve('frontend/src/services/api.js');

assert.ok(fs.existsSync(sidebarJsxPath), 'SidebarLeft.jsx must exist');
assert.ok(fs.existsSync(sidebarCssPath), 'SidebarLeft.css must exist');
assert.ok(fs.existsSync(publishJsxPath), 'PublishModal.jsx must exist');
assert.ok(fs.existsSync(publishCssPath), 'PublishModal.css must exist');
assert.ok(fs.existsSync(cardJsxPath), 'DocumentCard.jsx must exist');
assert.ok(fs.existsSync(feedJsxPath), 'FeedPage.jsx must exist');
assert.ok(fs.existsSync(apiJsPath), 'api.js must exist');

const sidebarJsx = fs.readFileSync(sidebarJsxPath, 'utf8');
const sidebarCss = fs.readFileSync(sidebarCssPath, 'utf8');
const publishJsx = fs.readFileSync(publishJsxPath, 'utf8');
const publishCss = fs.readFileSync(publishCssPath, 'utf8');
const cardJsx = fs.readFileSync(cardJsxPath, 'utf8');
const cardCss = fs.readFileSync(cardCssPath, 'utf8');
const feedJsx = fs.readFileSync(feedJsxPath, 'utf8');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');

// Test 1: No hardcoded topic lists in SidebarLeft.jsx
console.log('Test 1: Verification of removal of hardcoded topic lists');
assert.ok(!sidebarJsx.includes('DEFAULT_TOPICS'), 'DEFAULT_TOPICS must be removed from SidebarLeft.jsx');
assert.ok(sidebarJsx.includes('api.getTopics'), 'SidebarLeft.jsx must fetch real topics from database via api.getTopics');
assert.ok(sidebarJsx.includes('topic-count-badge'), 'SidebarLeft.jsx must render real count badge for topics');
assert.ok(sidebarCss.includes('.topic-count-badge'), 'SidebarLeft.css must style .topic-count-badge');
console.log('  PASSED\n');

// Test 2: Uncategorized topic handling in SidebarLeft
console.log('Test 2: Uncategorized topic handling in SidebarLeft');
assert.ok(sidebarJsx.includes('uncategorized'), 'SidebarLeft must handle uncategorized state');
console.log('  PASSED\n');

// Test 3: Topic selection field in PublishModal.jsx
console.log('Test 3: Topic selection in PublishModal.jsx');
assert.ok(publishJsx.includes('selectedTopics'), 'PublishModal.jsx must maintain selectedTopics state');
assert.ok(publishJsx.includes('availableTopics'), 'PublishModal.jsx must maintain availableTopics state');
assert.ok(publishJsx.includes('topic-input-field'), 'PublishModal.jsx must have a topic input field');
assert.ok(publishJsx.includes('selected-topic-pill'), 'PublishModal.jsx must render selected topic pills');
assert.ok(publishJsx.includes('btn-remove-topic'), 'PublishModal.jsx must have remove button on selected topics');
assert.ok(publishJsx.includes('topics-dropdown-menu'), 'PublishModal.jsx must render suggestions dropdown');
assert.ok(publishJsx.includes('/5 topics'), 'PublishModal.jsx must display topic limit (max 5 topics)');
console.log('  PASSED\n');

// Test 4: Topic persistence via FormData in PublishModal.jsx
console.log('Test 4: Topic persistence via FormData in PublishModal.jsx');
assert.ok(publishJsx.includes("formData.append('topics'"), 'PublishModal must append topics to formData');
assert.ok(publishCss.includes('.selected-topic-pill'), 'PublishModal.css must style .selected-topic-pill');
assert.ok(publishCss.includes('.topics-dropdown-menu'), 'PublishModal.css must style .topics-dropdown-menu');
console.log('  PASSED\n');

// Test 5: DocumentCard displays real database topics and Uncategorized fallback
console.log('Test 5: DocumentCard real topics and Uncategorized fallback');
assert.ok(!cardJsx.includes('deriveTags'), 'DocumentCard must not derive fake tags from title or text');
assert.ok(cardJsx.includes('doc.topics'), 'DocumentCard must read real doc.topics');
assert.ok(cardJsx.includes('Uncategorized'), 'DocumentCard must fall back to Uncategorized when no topics exist');
assert.ok(cardCss.includes('.card-tag.uncategorized'), 'DocumentCard.css must style .card-tag.uncategorized');
console.log('  PASSED\n');

// Test 6: FeedPage passes topic to backend without title-derived fake filtering
console.log('Test 6: FeedPage backend topic filtering');
assert.ok(feedJsx.includes('api.getFeed(topicFilter)'), 'FeedPage must pass topic filter directly to api.getFeed');
assert.ok(feedJsx.includes('api.searchDocuments(query.trim(), 25, topicFilter)'), 'FeedPage must pass topic filter to api.searchDocuments');
assert.ok(!feedJsx.includes('doc.title.toLowerCase().includes(topicKey)'), 'FeedPage must not do client-side title-matching for topics');
console.log('  PASSED\n');

// Test 7: Centralized api.js topic methods
console.log('Test 7: Centralized api.js topic methods');
assert.ok(apiJs.includes('getTopics(all = false)'), 'api.js must provide getTopics method');
assert.ok(apiJs.includes('getFeed(topic = null)'), 'api.js getFeed must accept topic parameter');
assert.ok(apiJs.includes('searchDocuments(query, limit = 10, topic = null'), 'api.js searchDocuments must accept topic parameter');
console.log('  PASSED\n');

console.log('=== All Document Topics Frontend Regression Tests Passed Successfully! ===\n');
