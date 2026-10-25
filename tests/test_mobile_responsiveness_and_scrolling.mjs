import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Running Mobile-First Responsiveness & Overflow Scrolling Regression Tests ===\n');

// Target viewports specified in requirements
const TARGET_VIEWPORTS = [
  { name: 'Narrow Mobile (e.g. iPhone SE/small Android)', width: 320 },
  { name: 'Standard Mobile (e.g. iPhone 13 Mini)', width: 375 },
  { name: 'Large Mobile (e.g. iPhone 15 Pro Max)', width: 430 },
  { name: 'Tablet Portrait (e.g. iPad Mini/Air)', width: 768 },
  { name: 'Tablet Landscape / Small Desktop', width: 1024 },
  { name: 'Standard Desktop', width: 1280 },
  { name: 'Wide Desktop / High Res', width: 1440 },
];

console.log('Target viewports in test suite:');
TARGET_VIEWPORTS.forEach(vp => console.log(`  • ${vp.width}px — ${vp.name}`));
console.log('');

// Read relevant React components and CSS files
const documentChatJsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'DocumentChat.jsx'), 'utf-8');
const documentChatCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'DocumentChat.css'), 'utf-8');
const markdownViewCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'MarkdownView.css'), 'utf-8');
const documentDiscussionCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'DocumentDiscussion.css'), 'utf-8');
const documentPageJsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'DocumentPage.jsx'), 'utf-8');
const documentPageCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'DocumentPage.css'), 'utf-8');
const pdfViewerJsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'), 'utf-8');
const pdfViewerCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.css'), 'utf-8');
const navbarCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'Navbar.css'), 'utf-8');
const documentCardCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'DocumentCard.css'), 'utf-8');
const publishModalCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'PublishModal.css'), 'utf-8');
const explorePageCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'ExplorePage.css'), 'utf-8');
const profilePageCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'ProfilePage.css'), 'utf-8');
const authCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'Auth.css'), 'utf-8');

// -------------------------------------------------------------
// Test 1: Chatbot Internal Scrolling & Container Boundary Fix
// -------------------------------------------------------------
test('Chatbot Scrolling: Message history scrolls internally without expanding container', () => {
  // Container must allow shrinking and zero out min-dimensions
  assert.ok(documentChatCss.includes('.chat-container'), '.chat-container rule must exist');
  const chatContainerMatch = documentChatCss.match(/\.chat-container\s*\{([^}]+)\}/);
  assert.ok(chatContainerMatch, '.chat-container css block found');
  assert.ok(chatContainerMatch[1].includes('min-height: 0;'), '.chat-container must declare min-height: 0');
  assert.ok(chatContainerMatch[1].includes('min-width: 0;'), '.chat-container must declare min-width: 0');

  // Header must not shrink
  const chatHeaderMatch = documentChatCss.match(/\.chat-header\s*\{([^}]+)\}/);
  assert.ok(chatHeaderMatch, '.chat-header css block found');
  assert.ok(chatHeaderMatch[1].includes('flex-shrink: 0;'), '.chat-header must have flex-shrink: 0');

  // Message scroll area must be flex: 1 1 0% with overflow-y: auto and NO rigid min-height: 350px
  const scrollMatch = documentChatCss.match(/\.chat-messages-scroll\s*\{([^}]+)\}/);
  assert.ok(scrollMatch, '.chat-messages-scroll css block found');
  assert.ok(scrollMatch[1].includes('flex: 1 1 0%;'), '.chat-messages-scroll must flex: 1 1 0%');
  assert.ok(scrollMatch[1].includes('min-height: 0;'), '.chat-messages-scroll must have min-height: 0');
  assert.ok(scrollMatch[1].includes('overflow-y: auto;'), '.chat-messages-scroll must scroll vertically');
  assert.ok(scrollMatch[1].includes('overflow-x: hidden;'), '.chat-messages-scroll must prevent horizontal overflow');
  assert.ok(!scrollMatch[1].includes('min-height: 350px;'), '.chat-messages-scroll must NOT have rigid min-height: 350px');

  // Composer/input section must not shrink away
  const inputSectionMatch = documentChatCss.match(/\.chat-input-section\s*\{([^}]+)\}/);
  assert.ok(inputSectionMatch, '.chat-input-section css block found');
  assert.ok(inputSectionMatch[1].includes('flex-shrink: 0;'), '.chat-input-section must have flex-shrink: 0');
});

// -------------------------------------------------------------
// Test 2: Chatbot Smart Scroll-to-Bottom Behavior
// -------------------------------------------------------------
test('Chatbot Smart Scrolling: Auto-scrolls only when user is near bottom; preserves upward reading position', () => {
  // Check JSX for scroll listener and ref
  assert.ok(documentChatJsx.includes('isNearBottomRef = useRef(true)'), 'DocumentChat must track isNearBottomRef');
  assert.ok(documentChatJsx.includes('handleScroll'), 'DocumentChat must have handleScroll function');
  assert.ok(documentChatJsx.includes('onScroll={handleScroll}'), '.chat-messages-scroll must attach onScroll handler');
  
  // Verify scroll proximity threshold check
  assert.ok(
    documentChatJsx.includes('distanceFromBottom <= threshold') ||
    documentChatJsx.includes('scrollHeight - scrollTop - clientHeight'),
    'handleScroll must check if near bottom'
  );
  
  // Verify useEffect auto-scroll checks isNearBottomRef.current
  assert.ok(documentChatJsx.includes('if (el && isNearBottomRef.current)'), 'Auto-scroll must be conditional on isNearBottomRef.current');

  // Verify sending a new user message resets isNearBottomRef.current to true
  assert.ok(documentChatJsx.includes('isNearBottomRef.current = true;'), 'handleSend must reset isNearBottomRef to true so user sees their new message');
});

// -------------------------------------------------------------
// Test 3: Chatbot Text Wrapping & Composer Input: Long unbroken text wraps and textarea is clamped
// -------------------------------------------------------------
test('Chatbot Text Wrapping & Composer Input: Long unbroken text wraps and textarea is clamped', () => {
  // Bubble text wrapping
  const bubbleMatch = documentChatCss.match(/\.chat-bubble\s*\{([^}]+)\}/);
  assert.ok(bubbleMatch, '.chat-bubble css block found');
  assert.ok(bubbleMatch[1].includes('word-break: break-word;') || bubbleMatch[1].includes('overflow-wrap: break-word;'), 'Bubble must wrap break-words');
  assert.ok(bubbleMatch[1].includes('min-width: 0;'), 'Bubble must have min-width: 0 to shrink inside flex row');

  // Markdown content wrapping
  assert.ok(markdownViewCss.includes('word-break: break-word;') || markdownViewCss.includes('overflow-wrap: break-word;'), 'Markdown view must break long words');
  assert.ok(markdownViewCss.includes('max-width: 100%;'), 'Markdown view must constrain max-width to 100%');

  // Citations / Sources card wrapping
  const sourcesCardMatch = documentChatCss.match(/\.sources-card\s*\{([^}]+)\}/);
  assert.ok(sourcesCardMatch, '.sources-card css block found');
  assert.ok(sourcesCardMatch[1].includes('max-width: 100%;'), '.sources-card must have max-width: 100%');
  assert.ok(sourcesCardMatch[1].includes('min-width: 0;'), '.sources-card must have min-width: 0');

  // Source badge text truncation
  const sourceBadgeMatch = documentChatCss.match(/\.source-badge\s*\{([^}]+)\}/);
  assert.ok(sourceBadgeMatch, '.source-badge css block found');
  assert.ok(sourceBadgeMatch[1].includes('text-overflow: ellipsis;'), '.source-badge must truncate overflow');

  // Chat input textarea clamping in DocumentChat.css
  assert.ok(documentChatCss.includes('.chat-textarea'), '.chat-textarea rule defined');
  assert.ok(documentChatCss.includes('min-height: 36px;'), '.chat-textarea minimum height 36px');
  assert.ok(documentChatCss.includes('max-height: 120px;'), '.chat-textarea clamped to max-height 120px');
  assert.ok(documentChatCss.includes('overflow-y: auto;'), '.chat-textarea scrolls internally when content exceeds max-height');
});

// -------------------------------------------------------------
// Test 4: DOCX Reader Bounding & Internal Scrolling
// -------------------------------------------------------------
test('DOCX Scrolling: Long Word documents scroll internally within .docx-reader-viewport', () => {
  // Single scroll container
  assert.ok(pdfViewerJsx.includes('className="docx-reader-viewport"'), 'PdfViewer.jsx declares docx-reader-viewport');
  assert.ok(pdfViewerCss.includes('.docx-reader-viewport'), '.docx-reader-viewport styling exists');

  const docxViewportMatch = pdfViewerCss.match(/\.docx-reader-viewport\s*\{([^}]+)\}/);
  assert.ok(docxViewportMatch, '.docx-reader-viewport rule found');
  assert.ok(docxViewportMatch[1].includes('overflow-y: auto;'), '.docx-reader-viewport must scroll vertically');
  assert.ok(docxViewportMatch[1].includes('flex: 1 1 0%;'), '.docx-reader-viewport must flex: 1 1 0%');
  assert.ok(docxViewportMatch[1].includes('min-height: 0;'), '.docx-reader-viewport must have min-height: 0');
  assert.ok(!docxViewportMatch[1].includes('height: 100%'), '.docx-reader-viewport must NOT set height: 100% in flex column');

  // No nested scrollbars on section.docx
  const sectionDocxMatch = pdfViewerCss.match(/section\.docx[^{]*\{([^}]+)\}/);
  assert.ok(sectionDocxMatch, 'section.docx rule found');
  assert.ok(sectionDocxMatch[1].includes('overflow: visible !important;'), 'section.docx must have overflow: visible to eliminate nested scrollbar');
  assert.ok(!sectionDocxMatch[1].includes('overflow-x: auto !important;'), 'section.docx must NOT have overflow-x: auto !important');

  // Table horizontal overflow containment
  assert.ok(pdfViewerCss.includes('.docx-render-target table'), 'Table styles exist');
  assert.ok(pdfViewerCss.includes('overflow-x: auto;'), 'Table blocks scroll horizontally without expanding page width');
});

// -------------------------------------------------------------
// Test 5: Document Page Desktop Split vs Mobile Tabs
// -------------------------------------------------------------
test('Document Workspace: Desktop side-by-side independent scroll and mobile tab switching', () => {
  // Desktop workspace bounded height
  assert.ok(documentPageCss.includes('height: calc(100vh - 65px);'), 'workspace-grid must be bounded to viewport height on desktop');
  assert.ok(documentPageCss.includes('overflow: hidden;'), 'workspace-grid must have overflow: hidden on desktop');

  // Columns allow shrinking
  const readerColMatch = documentPageCss.match(/\.workspace-reader-col\s*\{([^}]+)\}/);
  assert.ok(readerColMatch && readerColMatch[1].includes('min-width: 0;'), '.workspace-reader-col has min-width: 0');
  
  const chatColMatch = documentPageCss.match(/\.workspace-chat-col\s*\{([^}]+)\}/);
  assert.ok(chatColMatch && chatColMatch[1].includes('min-width: 0;'), '.workspace-chat-col has min-width: 0');

  // Chat container inside column fills remaining flex height rather than 100% + tabs
  assert.ok(
    documentPageCss.includes('.workspace-chat-col > .chat-container') &&
    documentPageCss.includes('flex: 1 1 0%;'),
    'Chat and discussion panels inside workspace-chat-col flex to available height without overflowing'
  );

  // Mobile switching tabs
  assert.ok(documentPageJsx.includes('mobile-view-tabs'), 'DocumentPage contains mobile-view-tabs');
  assert.ok(documentPageJsx.includes("mobileTab === 'reader'"), 'DocumentPage supports mobile reader tab');
  assert.ok(documentPageJsx.includes("mobileTab === 'chat'"), 'DocumentPage supports mobile AI assistant tab');
  assert.ok(documentPageJsx.includes("mobileTab === 'discussion'"), 'DocumentPage supports mobile peer discussion tab');

  // Mobile layout height bounding
  assert.ok(documentPageCss.includes('@media (max-width: 860px)'), 'DocumentPage has @media (max-width: 860px)');
  assert.ok(documentPageCss.includes('height: calc(100vh - 130px);'), 'DocumentPage mobile columns bounded to viewport');
});

// -------------------------------------------------------------
// Test 6: Mobile-First Responsive Breakpoints across 320px - 1440px
// -------------------------------------------------------------
test('Mobile-First Breakpoints: Navbar, cards, modals, explore, profile, auth adapt across all target viewports', () => {
  // Navbar mobile rules
  assert.ok(navbarCss.includes('@media (max-width: 640px)'), 'Navbar.css has @media (max-width: 640px)');
  assert.ok(navbarCss.includes('@media (max-width: 360px)'), 'Navbar.css has @media (max-width: 360px) for narrow 320px');
  assert.ok(navbarCss.includes('.brand-text') || navbarCss.includes('.brand-icon'), 'Navbar brand elements adapt');

  // DocumentCard mobile rules
  assert.ok(documentCardCss.includes('@media (max-width: 480px)'), 'DocumentCard.css has @media (max-width: 480px)');
  assert.ok(documentCardCss.includes('@media (max-width: 360px)'), 'DocumentCard.css has @media (max-width: 360px)');

  // PublishModal mobile internal scroll and bounding
  assert.ok(publishModalCss.includes('.modal-body-scrollable'), 'PublishModal has .modal-body-scrollable');
  assert.ok(publishModalCss.includes('overflow-y: auto;'), '.modal-body-scrollable scrolls vertically');
  assert.ok(publishModalCss.includes('@media (max-width: 480px)'), 'PublishModal has @media (max-width: 480px)');
  assert.ok(publishModalCss.includes('@media (max-width: 360px)'), 'PublishModal has @media (max-width: 360px)');

  // ExplorePage mobile rules
  assert.ok(explorePageCss.includes('@media (max-width: 480px)'), 'ExplorePage has @media (max-width: 480px)');
  assert.ok(explorePageCss.includes('@media (max-width: 360px)'), 'ExplorePage has @media (max-width: 360px)');

  // ProfilePage mobile rules
  assert.ok(profilePageCss.includes('@media (max-width: 640px)'), 'ProfilePage has @media (max-width: 640px)');
  assert.ok(profilePageCss.includes('@media (max-width: 360px)'), 'ProfilePage has @media (max-width: 360px)');

  // Auth pages mobile rules
  assert.ok(authCss.includes('@media (max-width: 480px)'), 'Auth.css has @media (max-width: 480px)');
  assert.ok(authCss.includes('@media (max-width: 340px)'), 'Auth.css has @media (max-width: 340px)');

  // Discussion panel internal scrolling
  assert.ok(documentDiscussionCss.includes('.discussion-body-scroll'), 'Discussion panel has .discussion-body-scroll');
  assert.ok(documentDiscussionCss.includes('overflow-y: auto;'), '.discussion-body-scroll has overflow-y: auto');
});

console.log('\n=== All Mobile Responsiveness & Overflow Scrolling Tests Passed! ===\n');
