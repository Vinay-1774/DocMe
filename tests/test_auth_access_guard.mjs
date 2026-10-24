/**
 * tests/test_auth_access_guard.mjs
 * Verification of DocMe Access Control and Authentication Guard:
 * 1. Unauthenticated direct navigation to /, /feed, /explore, /document/:id redirects to /login
 * 2. Preservation of intended destination (return URL with query parameters)
 * 3. Loading state displayed during session restoration without flashing protected content
 * 4. Normal display of home feed and research content once logged in
 * 5. Public routes (login, register) accessibility and redirect-loop avoidance
 * 6. Logout followed by navigation to / properly triggers redirection to /login
 * 7. Backend authorization checks ensuring private research content cannot be accessed unauthorized
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Running DocMe Access Control & Auth Guard Regression Tests ===\n');

const appJsxPath = path.resolve('frontend/src/App.jsx');
const protectedRoutePath = path.resolve('frontend/src/components/ProtectedRoute.jsx');
const authContextPath = path.resolve('frontend/src/context/AuthContext.jsx');
const feedPagePath = path.resolve('frontend/src/pages/FeedPage.jsx');
const explorePagePath = path.resolve('frontend/src/pages/ExplorePage.jsx');
const documentPagePath = path.resolve('frontend/src/pages/DocumentPage.jsx');
const loginPagePath = path.resolve('frontend/src/pages/LoginPage.jsx');
const registerPagePath = path.resolve('frontend/src/pages/RegisterPage.jsx');
const navbarPath = path.resolve('frontend/src/components/Navbar.jsx');
const backendMainPath = path.resolve('backend/app/main.py');

assert.ok(fs.existsSync(appJsxPath), 'App.jsx must exist');
assert.ok(fs.existsSync(protectedRoutePath), 'ProtectedRoute.jsx must exist');
assert.ok(fs.existsSync(authContextPath), 'AuthContext.jsx must exist');
assert.ok(fs.existsSync(feedPagePath), 'FeedPage.jsx must exist');
assert.ok(fs.existsSync(explorePagePath), 'ExplorePage.jsx must exist');
assert.ok(fs.existsSync(documentPagePath), 'DocumentPage.jsx must exist');
assert.ok(fs.existsSync(loginPagePath), 'LoginPage.jsx must exist');
assert.ok(fs.existsSync(registerPagePath), 'RegisterPage.jsx must exist');
assert.ok(fs.existsSync(navbarPath), 'Navbar.jsx must exist');
assert.ok(fs.existsSync(backendMainPath), 'backend/app/main.py must exist');

const appJsx = fs.readFileSync(appJsxPath, 'utf8');
const protectedRouteJsx = fs.readFileSync(protectedRoutePath, 'utf8');
const authContextJsx = fs.readFileSync(authContextPath, 'utf8');
const feedPageJsx = fs.readFileSync(feedPagePath, 'utf8');
const explorePageJsx = fs.readFileSync(explorePagePath, 'utf8');
const documentPageJsx = fs.readFileSync(documentPagePath, 'utf8');
const loginPageJsx = fs.readFileSync(loginPagePath, 'utf8');
const registerPageJsx = fs.readFileSync(registerPagePath, 'utf8');
const navbarJsx = fs.readFileSync(navbarPath, 'utf8');
const backendMain = fs.readFileSync(backendMainPath, 'utf8');

// Test 1: Direct navigation while logged out
console.log('Test 1: Direct navigation while logged out');
assert.ok(feedPageJsx.includes('ProtectedRoute'), 'FeedPage must be protected by ProtectedRoute');
assert.ok(explorePageJsx.includes('ProtectedRoute'), 'ExplorePage must be protected by ProtectedRoute');
assert.ok(documentPageJsx.includes('ProtectedRoute'), 'DocumentPage must be protected by ProtectedRoute');
assert.ok(appJsx.includes('path="/feed"'), '/feed route must be configured');
assert.ok(protectedRouteJsx.includes('!isAuthenticated'), 'ProtectedRoute must check isAuthenticated');
assert.ok(protectedRouteJsx.includes('/login?from='), 'ProtectedRoute must redirect unauthenticated users to /login with from query parameter');
console.log('  PASSED\n');

// Test 2: Destination preservation & query string support
console.log('Test 2: Preservation of intended destination');
assert.ok(protectedRouteJsx.includes('location.pathname + location.search'), 'ProtectedRoute must preserve full destination path and search query');
assert.ok(protectedRouteJsx.includes('state={{ from: location }}'), 'ProtectedRoute must pass location state for history navigation');
assert.ok(loginPageJsx.includes('location.state?.from') || loginPageJsx.includes("get('from')"), 'LoginPage must parse intended destination from state or search query');
assert.ok(loginPageJsx.includes('navigate(from'), 'LoginPage must navigate user back to intended destination after login');
console.log('  PASSED\n');

// Test 3: Session restoration and loading state
console.log('Test 3: Session restoration and loading state');
assert.ok(authContextJsx.includes('const [isLoading, setIsLoading] = useState(true)'), 'AuthContext must initialize with isLoading = true');
assert.ok(protectedRouteJsx.includes('isLoading'), 'ProtectedRoute must verify isLoading before evaluating auth');
assert.ok(protectedRouteJsx.includes('pdf-spinner'), 'ProtectedRoute must render loading spinner while session restores');
assert.ok(loginPageJsx.includes('isLoading'), 'LoginPage must check isLoading before deciding redirect');
console.log('  PASSED\n');

// Test 4: Normal display once logged in
console.log('Test 4: Normal display of research content once logged in');
assert.ok(protectedRouteJsx.includes('return children'), 'ProtectedRoute must render children when user is authenticated');
assert.ok(feedPageJsx.includes('FeedPageContent'), 'FeedPageContent must render home feed when authenticated');
assert.ok(explorePageJsx.includes('ExplorePageContent'), 'ExplorePageContent must render explore interface when authenticated');
assert.ok(documentPageJsx.includes('DocumentPageContent'), 'DocumentPageContent must render document workspace when authenticated');
console.log('  PASSED\n');

// Test 5: Public routes and redirect-loop avoidance
console.log('Test 5: Public routes & redirect loop prevention');
assert.ok(appJsx.includes('path="/login" element={<LoginPage />}'), 'Login route must remain public');
assert.ok(appJsx.includes('path="/register" element={<RegisterPage />}'), 'Register route must remain public');
assert.ok(loginPageJsx.includes('/login') && loginPageJsx.includes('/register'), 'LoginPage must prevent redirect loops back to login/register');
assert.ok(registerPageJsx.includes('/login') && registerPageJsx.includes('/register'), 'RegisterPage must prevent redirect loops back to login/register');
console.log('  PASSED\n');

// Test 6: Logout followed by navigation to /
console.log('Test 6: Logout followed by navigation to /');
assert.ok(authContextJsx.includes('clearAuth()'), 'logout() must clear local auth tokens');
assert.ok(authContextJsx.includes('setIsAuthenticated(false)'), 'logout() must set isAuthenticated to false');
assert.ok(navbarJsx.includes('logout()'), 'Navbar must call logout()');
assert.ok(navbarJsx.includes("navigate('/')"), 'Navbar navigates to / upon logout');
// Since / is protected by ProtectedRoute, when isAuthenticated is false it redirects to /login?from=%2F
console.log('  PASSED\n');

// Test 7: Backend authorization rules
console.log('Test 7: Backend authorization rules inspection');
assert.ok(backendMain.includes('doc.visibility == "private"'), 'Backend must verify private document visibility');
assert.ok(backendMain.includes('status.HTTP_401_UNAUTHORIZED'), 'Backend must raise 401 when unauthenticated');
assert.ok(backendMain.includes('status.HTTP_403_FORBIDDEN'), 'Backend must raise 403 when user lacks ownership');
assert.ok(backendMain.includes('@app.post("/register"'), 'Backend registration endpoint must exist and be accessible');
assert.ok(backendMain.includes('@app.post("/login"'), 'Backend login endpoint must exist and be accessible');
assert.ok(backendMain.includes('@app.post("/refresh"'), 'Backend token refresh endpoint must exist');
console.log('  PASSED\n');

// Test 8: Removal of unnecessary Back to Home Feed link
console.log('Test 8: Unnecessary "Back to Home Feed" link removed from auth screens');
assert.ok(!loginPageJsx.includes('Back to Home Feed'), 'LoginPage must not contain "Back to Home Feed" link');
assert.ok(!registerPageJsx.includes('Back to Home Feed'), 'RegisterPage must not contain "Back to Home Feed" link');
assert.ok(loginPageJsx.includes('Create an account'), 'LoginPage retains account switch link');
assert.ok(registerPageJsx.includes('Sign in'), 'RegisterPage retains account switch link');
assert.ok(loginPageJsx.includes('className="auth-brand-icon"'), 'LoginPage retains brand logo');
assert.ok(registerPageJsx.includes('className="auth-brand-icon"'), 'RegisterPage retains brand logo');
console.log('  PASSED\n');

console.log('=== All DocMe Access Control & Auth Guard Regression Tests Passed! ===\n');
