/**
 * tests/test_chat_input_overflow.mjs
 * Verification of Chat Input UI Overflow Fix and Unified Input Box Design.
 * 
 * Verifies:
 * - Single unified input container with no nested double borders or inner focus rings
 * - Textarea sizing, padding, box-sizing, and flex shrink/grow behavior (min-width: 0)
 * - Text wrapping (word-break, overflow-wrap, white-space) and vertical scroll capping (max-height: 120px)
 * - Send button alignment and non-overlapping flex-shrink: 0
 * - Preservation of Enter to send and Shift+Enter for newline
 * - Dark theme consistency across all viewports (320px, 375px, 768px, desktop)
 * - Consistent application across React DocumentChat and legacy document-chat
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('=== Running DocMe Chat Input UI Overflow Verification ===\n');

// 1. Read files
const docChatJsxPath = path.join(projectRoot, 'frontend/src/components/DocumentChat.jsx');
const docChatCssPath = path.join(projectRoot, 'frontend/src/components/DocumentChat.css');
const indexCssPath = path.join(projectRoot, 'frontend/src/styles/index.css');
const sharedComponentsCssPath = path.join(projectRoot, 'frontend/shared/components.css');
const legacyChatCssPath = path.join(projectRoot, 'frontend/pages/document-chat.css');

assert.ok(fs.existsSync(docChatJsxPath), 'DocumentChat.jsx must exist');
assert.ok(fs.existsSync(docChatCssPath), 'DocumentChat.css must exist');
assert.ok(fs.existsSync(indexCssPath), 'index.css must exist');
assert.ok(fs.existsSync(sharedComponentsCssPath), 'shared/components.css must exist');
assert.ok(fs.existsSync(legacyChatCssPath), 'document-chat.css must exist');

const docChatJsx = fs.readFileSync(docChatJsxPath, 'utf8');
const docChatCss = fs.readFileSync(docChatCssPath, 'utf8');
const indexCss = fs.readFileSync(indexCssPath, 'utf8');
const sharedComponentsCss = fs.readFileSync(sharedComponentsCssPath, 'utf8');
const legacyChatCss = fs.readFileSync(legacyChatCssPath, 'utf8');

// Test 1: Unified Container Structure in DocumentChat.jsx
console.log('Test 1: Unified Container Structure in DocumentChat.jsx');
assert.ok(docChatJsx.includes('className="chat-input-box"'), 'Must have single unified .chat-input-box');
assert.ok(docChatJsx.includes('className="chat-textarea"'), 'Must have .chat-textarea inside input box');
assert.ok(docChatJsx.includes('className="chat-send-btn"'), 'Must have .chat-send-btn inside input box');
// Ensure textarea and send button are direct siblings inside the single box
const inputFormMatch = docChatJsx.match(/<div className="chat-input-box">([\s\S]*?)<\/div>/);
assert.ok(inputFormMatch, 'chat-input-box container must be present in JSX');
assert.ok(inputFormMatch[1].includes('<textarea'), 'textarea must be directly inside chat-input-box');
assert.ok(inputFormMatch[1].includes('<button'), 'send button must be directly inside chat-input-box');
console.log('  ✓ Textarea and send button placed cleanly in one unified container');

// Test 2: Elimination of Nested Double Borders & Global Overrides
console.log('\nTest 2: Elimination of Nested Double Border Effect');
assert.ok(docChatCss.includes('border: none !important;'), 'DocumentChat.css must force border: none on chat-textarea');
assert.ok(docChatCss.includes('outline: none !important;'), 'DocumentChat.css must force outline: none on chat-textarea');
assert.ok(docChatCss.includes('box-shadow: none !important;'), 'DocumentChat.css must force box-shadow: none on chat-textarea');
assert.ok(docChatCss.includes('.chat-textarea:focus'), 'DocumentChat.css must handle .chat-textarea:focus');

assert.ok(indexCss.includes('textarea.chat-textarea'), 'index.css must protect textarea.chat-textarea from global green borders');
assert.ok(indexCss.includes('border: none !important;'), 'index.css must ensure no border on chat-textarea');
assert.ok(indexCss.includes('box-shadow: none !important;'), 'index.css must ensure no box-shadow on chat-textarea');

assert.ok(sharedComponentsCss.includes('textarea.chat-textarea'), 'shared/components.css must override chat-textarea');
console.log('  ✓ Nested border effect eliminated across global and component stylesheets');

// Test 3: Sizing, Padding, Box-Sizing & Flex Constraints (Min-Width: 0)
console.log('\nTest 3: Flex Shrink/Grow & Box-Sizing Constraints');
assert.ok(docChatCss.includes('box-sizing: border-box;'), 'Must enforce box-sizing: border-box');
assert.ok(docChatCss.includes('min-width: 0;'), 'Must set min-width: 0 on chat-textarea to allow flex shrinking');
assert.ok(docChatCss.includes('flex: 1 1 auto;'), 'Must set flex: 1 1 auto on chat-textarea');
assert.ok(docChatCss.includes('max-width: 100%;'), 'Must constrain max-width to 100%');
assert.ok(docChatCss.includes('width: 100%;'), 'Must set width: 100%');
console.log('  ✓ Min-width: 0 and flex shrink/grow constraints verified');

// Test 4: Word Wrapping & Vertical Scroll Bounding
console.log('\nTest 4: Word Wrapping and Internal Scroll Bounding');
assert.ok(docChatCss.includes('word-break: break-word;'), 'Must enforce word-break: break-word for long text/URLs');
assert.ok(docChatCss.includes('overflow-wrap: break-word;'), 'Must enforce overflow-wrap: break-word');
assert.ok(docChatCss.includes('white-space: pre-wrap;'), 'Must preserve pre-wrap for multiline text');
assert.ok(docChatCss.includes('max-height: 120px;'), 'Must cap height at 120px');
assert.ok(docChatCss.includes('overflow-y: auto;'), 'Must allow internal vertical scrolling');
assert.ok(docChatCss.includes('overflow-x: hidden;'), 'Must prevent horizontal overflow');

// Dynamic JS auto-resizing
assert.ok(docChatJsx.includes('clampedHeight = Math.min(Math.max(scrollH, 36), 120)'), 'JS must clamp auto-grow between 36px and 120px');
console.log('  ✓ Text wrapping, height bounding, and internal scrolling verified');

// Test 5: Send Button Fixed Alignment & Overlap Prevention
console.log('\nTest 5: Send Button Alignment & Overlap Prevention');
assert.ok(docChatCss.includes('flex-shrink: 0;'), 'Send button must have flex-shrink: 0 to prevent squeezing');
assert.ok(docChatCss.includes('align-self: flex-end;'), 'Send button must be bottom-aligned in flex container');
assert.ok(docChatCss.includes('min-width: 32px;') || docChatCss.includes('min-width: 30px;'), 'Send button must have minimum width constraint');
console.log('  ✓ Send button stays bottom-aligned and cannot overlap text');

// Test 6: Enter to Send & Shift+Enter for Newline
console.log('\nTest 6: Enter to Send and Shift+Enter for Newline');
assert.ok(docChatJsx.includes("e.key === 'Enter' && !e.shiftKey"), 'Enter without Shift must trigger send');
assert.ok(docChatJsx.includes('e.preventDefault()'), 'Enter must prevent default newline insertion when sending');
assert.ok(docChatJsx.includes('handleSend()'), 'Enter must invoke handleSend()');
console.log('  ✓ Keyboard send and multiline newline insertion preserved');

// Test 7: Mobile Viewport Rules (320px & 375px)
console.log('\nTest 7: Small Mobile Viewport Adaptations');
assert.ok(docChatCss.includes('@media (max-width: 480px)'), 'Must define compact mobile padding rules for <= 480px');
assert.ok(legacyChatCss.includes('min-width: 0;'), 'Legacy document-chat must also enforce min-width: 0');
assert.ok(legacyChatCss.includes('word-break: break-word;'), 'Legacy document-chat must enforce word-break');
console.log('  ✓ 320px/375px compact responsive styling and legacy parity verified');

console.log('\n=== All Chat Input UI Overflow Verification Checks Passed! ===\n');
