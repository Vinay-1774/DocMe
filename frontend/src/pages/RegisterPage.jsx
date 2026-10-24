import React, { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { FileText, ArrowRight, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import './Auth.css';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const { register, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Extract safe return destination
  const statePath = location.state?.from
    ? (typeof location.state.from === 'string'
        ? location.state.from
        : (location.state.from.pathname + (location.state.from.search || '')))
    : null;
  const rawFrom = location.state?.from?.pathname || statePath || new URLSearchParams(location.search).get('from') || '/';
  const from = (rawFrom.startsWith('/login') || rawFrom.startsWith('/register')) ? '/' : rawFrom;

  // While restoring session, display loading spinner rather than flashing register form
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

    const errors = {};
    if (!username.trim()) {
      errors.username = 'Username is required.';
    }
    if (!email.trim()) {
      errors.email = 'Email address is required.';
    }
    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    if (password && confirmPassword && password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    } else if (password && !confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Please check the errors below and try again.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setFieldErrors({});

      await register(username.trim(), email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not create account. The username or email may already be in use.');
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
          <h1 className="auth-title">Create your DocMe Account</h1>
          <p className="auth-subtitle">
            Join the research community to publish papers, discuss preprints, and explore science.
          </p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="auth-alert-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div className="auth-input-group">
            <label htmlFor="reg-username" className="auth-label">
              Username
            </label>
            <input
              id="reg-username"
              type="text"
              className={`auth-input ${fieldErrors.username ? 'invalid' : ''}`}
              placeholder="e.g., marie_curie"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: null }));
              }}
              disabled={loading}
              autoComplete="username"
              required
              autoFocus
            />
            {fieldErrors.username && (
              <span className="auth-field-error">{fieldErrors.username}</span>
            )}
          </div>

          {/* Email */}
          <div className="auth-input-group">
            <label htmlFor="reg-email" className="auth-label">
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              className={`auth-input ${fieldErrors.email ? 'invalid' : ''}`}
              placeholder="researcher@institution.org"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: null }));
              }}
              disabled={loading}
              autoComplete="email"
              required
            />
            {fieldErrors.email && (
              <span className="auth-field-error">{fieldErrors.email}</span>
            )}
          </div>

          {/* Password with Show/Hide Toggle */}
          <div className="auth-input-group">
            <label htmlFor="reg-password" className="auth-label">
              Password (min. 6 characters)
            </label>
            <div className="auth-password-wrapper">
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                className={`auth-input ${fieldErrors.password ? 'invalid' : ''}`}
                placeholder="Choose a secure password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: null }));
                }}
                disabled={loading}
                autoComplete="new-password"
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
            {fieldErrors.password && (
              <span className="auth-field-error">{fieldErrors.password}</span>
            )}
          </div>

          {/* Confirm Password (Frontend Validation Field) */}
          <div className="auth-input-group">
            <label htmlFor="reg-confirm-password" className="auth-label">
              Confirm Password
            </label>
            <div className="auth-password-wrapper">
              <input
                id="reg-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                className={`auth-input ${fieldErrors.confirmPassword ? 'invalid' : ''}`}
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (fieldErrors.confirmPassword) setFieldErrors((prev) => ({ ...prev, confirmPassword: null }));
                }}
                disabled={loading}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                tabIndex={0}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldErrors.confirmPassword && (
              <span className="auth-field-error">{fieldErrors.confirmPassword}</span>
            )}
          </div>

          {/* Submit Action */}
          <button
            type="submit"
            className="auth-btn-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="auth-spinner" />
                <span>Creating account...</span>
              </>
            ) : (
              <>
                <span>Create Account</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Footer Navigation */}
        <p className="auth-footer-text">
          Already have an account?{' '}
          <Link
            to={from !== '/' ? `/login?from=${encodeURIComponent(from)}` : '/login'}
            className="auth-link"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
