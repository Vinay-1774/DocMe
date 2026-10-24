import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

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

  if (!isAuthenticated) {
    // Preserve intended destination path in both search query and history state
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?from=${returnUrl}`} state={{ from: location }} replace />;
  }

  return children;
}
