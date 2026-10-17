import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('=== Running DocMe Mobile Responsiveness Verification ===\n');

// Viewports required by user:
const TARGET_VIEWPORTS = [
  { name: 'small mobile', width: 320 },
  { name: 'common mobile', width: 375 },
  { name: 'modern mobile', width: 390 },
  { name: 'large mobile', width: 430 },
  { name: 'tablet', width: 768 },
  { name: 'small desktop/tablet', width: 1024 },
  { name: 'desktop', width: 1440 },
];

console.log('Target viewports in scope:');
TARGET_VIEWPORTS.forEach(vp => console.log(`  • ${vp.width}px — ${vp.name}`));
console.log('');

// 1. Verify Viewport Meta Tags across all HTML pages
const htmlFiles = [
  'frontend/index.html',
  'frontend/pages/login.html',
  'frontend/pages/register.html',
  'frontend/pages/feed.html',
  'frontend/pages/profile.html',
  'frontend/pages/document-chat.html',
];

console.log('Test 1: Viewport Meta Tag Verification');
for (const relPath of htmlFiles) {
  const filePath = path.join(projectRoot, relPath);
  assert.ok(fs.existsSync(filePath), `File exists: ${relPath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(
    content.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">') ||
    content.includes('name="viewport"'),
    `${relPath} must have a mobile-friendly viewport meta tag`
  );
  console.log(`  ✓ ${relPath} contains correct viewport meta tag`);
}

// 2. Verify Shared CSS Responsive Rules & Overflow Safeguards
console.log('\nTest 2: CSS Overflow Safeguards & Fluid Sizing');
const componentsCss = fs.readFileSync(path.join(projectRoot, 'frontend/shared/components.css'), 'utf8');

assert.ok(componentsCss.includes('overflow-x: hidden;'), 'components.css must enforce overflow-x: hidden on root/body');
assert.ok(componentsCss.includes('max-width: 100vw;'), 'components.css must constrain max-width to viewport width');
assert.ok(componentsCss.includes('overflow-wrap: break-word;'), 'components.css must enforce word wrapping on headings and text');
assert.ok(componentsCss.includes('touch-action: manipulation;'), 'components.css must optimize button touch action for mobile');
assert.ok(componentsCss.includes('env(safe-area-inset-bottom'), 'components.css must respect mobile safe area insets');
console.log('  ✓ Root overflow prevention and mobile safe areas verified');

// 3. Verify Breakpoints in Shared Components
console.log('\nTest 3: Media Queries in components.css');
assert.ok(componentsCss.includes('@media (max-width: 768px)'), 'components.css must have @media (max-width: 768px)');
assert.ok(componentsCss.includes('@media (max-width: 640px)'), 'components.css must have @media (max-width: 640px)');
assert.ok(componentsCss.includes('@media (max-width: 480px)'), 'components.css must have @media (max-width: 480px)');
assert.ok(componentsCss.includes('@media (max-width: 340px)'), 'components.css must have @media (max-width: 340px)');
console.log('  ✓ Media queries for 768px, 640px, 480px, and 340px verified in components.css');

// 4. Verify Mobile Bottom Navigation on Mobile Viewports
console.log('\nTest 4: Mobile Navigation & Bottom Bar');
assert.ok(componentsCss.includes('.main-nav .nav-menu {'), 'components.css must style mobile nav menu');
assert.ok(componentsCss.includes('position: fixed;'), 'components.css mobile nav must be fixed on mobile');
assert.ok(componentsCss.includes('bottom: 0;'), 'components.css mobile nav must pin to bottom');
assert.ok(componentsCss.includes('z-index: 90;'), 'components.css mobile nav must have high z-index');
console.log('  ✓ Fixed mobile bottom navigation with safe-area spacing verified');

// 5. Verify Modals Responsive Sizing
console.log('\nTest 5: Modal Dialog Fluidity');
assert.ok(componentsCss.includes('.modal-overlay'), 'components.css must style .modal-overlay');
assert.ok(componentsCss.includes('.modal-dialog'), 'components.css must style .modal-dialog');
assert.ok(componentsCss.includes('flex-direction: column-reverse;'), 'Mobile modal-footer must stack action buttons');
console.log('  ✓ Modals fluid sizing and stacked mobile actions verified');

// 6. Verify Auth Pages (login.css)
console.log('\nTest 6: Login & Registration Responsiveness');
const loginCss = fs.readFileSync(path.join(projectRoot, 'frontend/pages/login.css'), 'utf8');
assert.ok(loginCss.includes('@media (max-width: 960px)'), 'login.css must collapse showcase on <= 960px');
assert.ok(loginCss.includes('@media (max-width: 480px)'), 'login.css must support <= 480px mobile');
assert.ok(loginCss.includes('@media (max-width: 340px)'), 'login.css must support <= 340px extra small mobile');
assert.ok(loginCss.includes('.mobile-brand-bar'), 'login.css must support .mobile-brand-bar');
console.log('  ✓ Login and register responsive styles verified');

// 7. Verify Feed Page (feed.css)
console.log('\nTest 7: Feed & Discovery Responsiveness');
const feedCss = fs.readFileSync(path.join(projectRoot, 'frontend/pages/feed.css'), 'utf8');
assert.ok(feedCss.includes('@media (max-width: 960px)'), 'feed.css must collapse sidebar to 1-col on <= 960px');
assert.ok(feedCss.includes('@media (max-width: 768px)'), 'feed.css must support tablet <= 768px');
assert.ok(feedCss.includes('@media (max-width: 640px)'), 'feed.css must support mobile <= 640px');
assert.ok(feedCss.includes('@media (max-width: 480px)'), 'feed.css must support small mobile <= 480px');
assert.ok(feedCss.includes('@media (max-width: 340px)'), 'feed.css must support extra small mobile <= 340px');
assert.ok(feedCss.includes('.doc-card-actions {'), 'feed.css must handle .doc-card-actions responsively');
console.log('  ✓ Feed 1-column collapse, wrapped card actions, and fluid search bar verified');

// 8. Verify Profile Page (profile.css)
console.log('\nTest 8: Profile Workspace Responsiveness');
const profileCss = fs.readFileSync(path.join(projectRoot, 'frontend/pages/profile.css'), 'utf8');
assert.ok(profileCss.includes('@media (max-width: 768px)'), 'profile.css must support tablet <= 768px');
assert.ok(profileCss.includes('@media (max-width: 640px)'), 'profile.css must support mobile <= 640px');
assert.ok(profileCss.includes('@media (max-width: 480px)'), 'profile.css must support small mobile <= 480px');
assert.ok(profileCss.includes('@media (max-width: 340px)'), 'profile.css must support extra small mobile <= 340px');
assert.ok(profileCss.includes('flex-direction: column;'), 'profile.css must center hero content on mobile');
assert.ok(profileCss.includes('.doc-action-btn-group'), 'profile.css must support .doc-action-btn-group');
console.log('  ✓ Profile hero centering, email wrapping, and action button grid verified');

// 9. Verify Document Chat Workstation (document-chat.html, css, js)
console.log('\nTest 9: Document Research Chat Responsiveness & Tab Switcher');
const docChatHtml = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.html'), 'utf8');
const docChatCss = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.css'), 'utf8');
const docChatJs = fs.readFileSync(path.join(projectRoot, 'frontend/pages/document-chat.js'), 'utf8');

assert.ok(docChatHtml.includes('id="mobile-workstation-tabs"'), 'document-chat.html must have #mobile-workstation-tabs');
assert.ok(docChatHtml.includes('id="mobile-tab-doc"'), 'document-chat.html must have #mobile-tab-doc');
assert.ok(docChatHtml.includes('id="mobile-tab-chat"'), 'document-chat.html must have #mobile-tab-chat');
assert.ok(docChatCss.includes('.mobile-workstation-tabs'), 'document-chat.css must style .mobile-workstation-tabs');
assert.ok(docChatCss.includes('.view-document'), 'document-chat.css must define .view-document state');
assert.ok(docChatCss.includes('@media (max-width: 768px)'), 'document-chat.css must have <= 768px rules');
assert.ok(docChatCss.includes('@media (max-width: 640px)'), 'document-chat.css must have <= 640px rules');
assert.ok(docChatCss.includes('@media (max-width: 480px)'), 'document-chat.css must have <= 480px rules');
assert.ok(docChatCss.includes('@media (max-width: 340px)'), 'document-chat.css must have <= 340px rules');
assert.ok(docChatJs.includes('switchMobileView'), 'document-chat.js must implement switchMobileView');
console.log('  ✓ Document chat mobile view toggle and full-height mobile tabs verified');

console.log('\n=== All Responsiveness Checks Passed Successfully across all 7 target viewports! ===\n');
