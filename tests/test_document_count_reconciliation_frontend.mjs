import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Running DocMe Document Count Reconciliation Frontend Regression Tests ===\n');

// 1. ProfilePage loads user documents via api.getDocuments('mine') when viewing own profile
console.log('Test 1: ProfilePage uses api.getDocuments(\'mine\') for authenticated owner');
const profilePagePath = path.join(rootDir, 'frontend/src/pages/ProfilePage.jsx');
const profilePageContent = fs.readFileSync(profilePagePath, 'utf-8');

assert.ok(
  profilePageContent.includes("if (isOwnProfile) {\n        docs = await api.getDocuments('mine');\n      } else {\n        docs = await api.getContributorDocuments(targetUserId);\n      }"),
  'ProfilePage must use api.getDocuments(\'mine\') for own profile and getContributorDocuments for other contributors'
);
console.log('  PASSED\n');

// 2. Stat box labels differentiate Total Documents (owner) vs Shared Publications (visitor)
console.log('Test 2: Stat box labels clearly distinguish owner total from visitor shared publications');
assert.ok(
  profilePageContent.includes("{isOwnProfile ? 'Total Documents' : 'Shared Publications'}"),
  'ProfilePage must label document count as Total Documents for owner and Shared Publications for visitors'
);
assert.ok(
  profilePageContent.includes("Private Papers"),
  'ProfilePage must include Private Papers metric for authenticated owner'
);
console.log('  PASSED\n');

// 3. Visibility filter pills in ProfilePage
console.log('Test 3: Visibility filter pills support All, Public, and Private tabs');
assert.ok(
  profilePageContent.includes("All ({documents.length})") &&
  profilePageContent.includes("Public ({publicCount})") &&
  profilePageContent.includes("Private ({privateCount})"),
  'ProfilePage must render All, Public, and Private filter pills with accurate item counts'
);
console.log('  PASSED\n');

// 4. ExplorePage and SidebarRight label contributor counts consistently
console.log('Test 4: ExplorePage and SidebarRight clearly label contributor ranking counts');
const explorePagePath = path.join(rootDir, 'frontend/src/pages/ExplorePage.jsx');
const explorePageContent = fs.readFileSync(explorePagePath, 'utf-8');

assert.ok(
  explorePageContent.includes('<span className="topics-hint-badge">Total research uploads</span>'),
  'ExplorePage Top Contributors section must clarify that ranking is by total research uploads'
);

const sidebarRightPath = path.join(rootDir, 'frontend/src/components/SidebarRight.jsx');
const sidebarRightContent = fs.readFileSync(sidebarRightPath, 'utf-8');

assert.ok(
  sidebarRightContent.includes('total uploaded documents'),
  'SidebarRight must include descriptive title for ranking document counts'
);
console.log('  PASSED\n');

// 5. ProfilePage error handling when document loading fails
console.log('Test 5: ProfilePage displays clear error state if document loading fails');
assert.ok(
  profilePageContent.includes('className="feed-error-state"') &&
  profilePageContent.includes('Profile Unavailable'),
  'ProfilePage must display clear error state when request fails instead of silently failing'
);
console.log('  PASSED\n');

console.log('=== All DocMe Document Count Reconciliation Frontend Tests Passed! ===\n');
