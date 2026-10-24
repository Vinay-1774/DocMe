import React, { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { FileText, ArrowRight, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import './Auth.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Extract safe return destination (preserving query parameters and avoiding redirect loops)
  const statePath = location.state?.from
    ? (typeof location.state.from === 'string'
        ? location.state.from
        : (location.state.from.pathname + (location.state.from.search || '')))
    : null;
  const rawFrom = location.state?.from?.pathname || statePath || new URLSearchParams(location.search).get('from') || '/';
  const from = (rawFrom.startsWith('/login') || rawFrom.startsWith('/register')) ? '/' : rawFrom;

  // While restoring session, display loading spinner rather than flashing login form
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
      }}>
        <div className="pdf-spinner" style={{ width: '36px', height: '36px' }} />
      </div>
    );
  }

  // If already authenticated, redirect to destination immediately without redirect loop
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please provide both your email address and password.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await login(email.trim(), password);
      // Return user to intended destination or home
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Incorrect email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" role="main">
        {/* Brand Header */}
        <div className="auth-brand">
          <Link to="/" className="auth-brand-icon" aria-label="DocMe Home">
            <FileText size={24} strokeWidth={2.5} />
          </Link>
          <h1 className="auth-title">Welcome back to DocMe</h1>
          <p className="auth-subtitle">
            Sign in to access your research papers, peer discussions, and AI assistant.
          </p>
        </div>

        {/* Notice if redirected from a protected page */}
        {from !== '/' && !error && (
          <div className="auth-alert-info">
            <span>Please log in to continue.</span>
          </div>
        )}

        {/* Server / Validation Error */}
        {error && (
          <div className="auth-alert-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div className="auth-input-group">
            <label htmlFor="login-email" className="auth-label">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              className="auth-input"
              placeholder="researcher@university.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              disabled={loading}
              autoComplete="email"
              required
              autoFocus
            />
          </div>

          {/* Password with Show/Hide Toggle */}
          <div className="auth-input-group">
            <div className="auth-label-row">
              <label htmlFor="login-password" className="auth-label">
                Password
              </label>
            </div>
            <div className="auth-password-wrapper">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                disabled={loading}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={0}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit Action */}
          <button
            type="submit"
            className="auth-btn-submit"
            disabled={loading || !email.trim() || !password}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="auth-spinner" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Footer Navigation */}
        <p className="auth-footer-text">
          Don&apos;t have an account?{' '}
          <Link
            to={from !== '/' ? `/register?from=${encodeURIComponent(from)}` : '/register'}
            className="auth-link"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
