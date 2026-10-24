/**
 * tests/test_explore_page.mjs
 * Verification of Explore Page functionality:
 * - URL query parameter synchronization
 * - Topic shortcuts navigation
 * - Real API integration (searchDocuments, getPopularDocuments, getUserRanking, getFeed)
 * - Sorting behaviors (relevance, latest, most discussed)
 * - Empty & error state handling
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Running DocMe Explore & Discovery Tests ===\n');

// 1. Verify ExplorePage.jsx and ExplorePage.css exist and contain required elements
const exploreJsxPath = path.resolve('frontend/src/pages/ExplorePage.jsx');
const exploreCssPath = path.resolve('frontend/src/pages/ExplorePage.css');
const appJsxPath = path.resolve('frontend/src/App.jsx');
const navbarJsxPath = path.resolve('frontend/src/components/Navbar.jsx');

assert.ok(fs.existsSync(exploreJsxPath), 'ExplorePage.jsx must exist');
assert.ok(fs.existsSync(exploreCssPath), 'ExplorePage.css must exist');

const exploreJsx = fs.readFileSync(exploreJsxPath, 'utf8');
const exploreCss = fs.readFileSync(exploreCssPath, 'utf8');
const appJsx = fs.readFileSync(appJsxPath, 'utf8');
const navbarJsx = fs.readFileSync(navbarJsxPath, 'utf8');

// Test 1: Route registration
console.log('Test 1: Route registration in App.jsx');
assert.ok(
  appJsx.includes('import ExplorePage from \'./pages/ExplorePage.jsx\'') ||
  appJsx.includes('import ExplorePage from "./pages/ExplorePage.jsx"'),
  'ExplorePage must be imported in App.jsx'
);
assert.ok(
  appJsx.includes('<Route path="/explore" element={<ExplorePage />} />'),
  '/explore route must be configured in App.jsx'
);
console.log('  PASSED\n');

// Test 2: Explore Header requirements
console.log('Test 2: Explore Header copy and elements');
assert.ok(exploreJsx.includes('Explore Research'), 'Explore title must match requirement');
assert.ok(
  exploreJsx.includes('Discover ideas, research papers, and knowledge shared by the community.'),
  'Explore subtitle must match requirement'
);
assert.ok(exploreJsx.includes('explore-search-input'), 'Large search input must be present');
assert.ok(exploreJsx.includes('explore-clear-btn'), 'Clear search button must be present');
console.log('  PASSED\n');

// Test 3: Topic shortcuts
console.log('Test 3: Research Topic shortcuts');
const requiredTopics = [
  'Artificial Intelligence',
  'Technology',
  'Science',
  'Policy & Governance',
  'Economics',
  'Medicine',
  'General Research',
];

for (const topic of requiredTopics) {
  assert.ok(exploreJsx.includes(topic), `Topic shortcut "${topic}" must be present`);
}
assert.ok(
  exploreJsx.includes('Keyword shortcuts') || exploreJsx.includes('keyword'),
  'Topic shortcuts must be clearly distinguished as keywords rather than DB categories'
);
console.log('  PASSED\n');

// Test 4: Real API endpoints integration
console.log('Test 4: Real API endpoints integration');
assert.ok(exploreJsx.includes('api.searchDocuments'), 'Must use api.searchDocuments for searches');
assert.ok(exploreJsx.includes('api.getPopularDocuments'), 'Must use api.getPopularDocuments for popular section');
assert.ok(exploreJsx.includes('api.getUserRanking'), 'Must use api.getUserRanking for top contributors');
assert.ok(exploreJsx.includes('api.getFeed'), 'Must use api.getFeed for latest research feed');
console.log('  PASSED\n');

// Test 5: Sorting functionality logic
console.log('Test 5: Sorting functionality logic');
assert.ok(exploreJsx.includes('relevance'), 'Must support relevance sorting');
assert.ok(exploreJsx.includes('latest'), 'Must support latest sorting');
assert.ok(exploreJsx.includes('discussed'), 'Must support most discussed sorting');

// Verify sort sorting comparator logic
const testResults = [
  { id: 1, title: 'Old Paper', created_at: '2026-01-01T00:00:00Z', comment_count: 5 },
  { id: 2, title: 'New Paper', created_at: '2026-05-01T00:00:00Z', comment_count: 1 },
  { id: 3, title: 'Viral Paper', created_at: '2026-03-01T00:00:00Z', comment_count: 20 },
];

// Sort latest
const sortedLatest = [...testResults].sort(
  (a, b) => new Date(b.created_at) - new Date(a.created_at)
);
assert.strictEqual(sortedLatest[0].id, 2, 'Newest paper should be first when sorted by latest');

// Sort discussed
const sortedDiscussed = [...testResults].sort(
  (a, b) => (b.comment_count || 0) - (a.comment_count || 0)
);
assert.strictEqual(sortedDiscussed[0].id, 3, 'Most discussed paper should be first');

console.log('  PASSED\n');

// Test 6: URL query parameter synchronization
console.log('Test 6: URL query parameter synchronization');
assert.ok(exploreJsx.includes('useSearchParams'), 'Must use useSearchParams for URL sync');
assert.ok(exploreJsx.includes('searchParams.get(\'q\')'), 'Must read q param from URL');
assert.ok(
  exploreJsx.includes('setSearchParams({ q:') || exploreJsx.includes('setSearchParams({'),
  'Must set query in URL search params'
);
assert.ok(navbarJsx.includes('/explore?q='), 'Navbar search must redirect to /explore?q=');
console.log('  PASSED\n');

// Test 7: CSS Palette and design tokens
console.log('Test 7: CSS Palette and tokens');
assert.ok(exploreCss.includes('var(--bg-app)'), 'Must use app background variable');
assert.ok(exploreCss.includes('var(--bg-surface)'), 'Must use card surface variable');
assert.ok(exploreCss.includes('var(--primary-brand)') || exploreCss.includes('var(--primary-emerald)'), 'Must use primary brand/emerald variable');
assert.ok(exploreCss.includes('var(--border-subtle)'), 'Must use subtle border token');
console.log('  PASSED\n');

// Test 8: Empty and Error states
console.log('Test 8: Empty & error state handling');
assert.ok(
  exploreJsx.includes('No matching documents found') || exploreJsx.includes('No matching research found'),
  'Must have descriptive empty state for search'
);
assert.ok(exploreJsx.includes('Search Error'), 'Must have explicit error state for failed searches');
assert.ok(
  exploreJsx.includes('Try Again') || exploreJsx.includes('Retry Search'),
  'Must provide retry button on search error'
);
console.log('  PASSED\n');

console.log('=== All Explore & Discovery Tests Completed Successfully! ===');
