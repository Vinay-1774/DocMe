import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../services/api.js';
import {
  getToken,
  setToken,
  getUser,
  setUser,
  clearAuth,
  isAuthenticated as checkIsAuthenticated,
  scheduleTokenRefresh,
} from '../services/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setLocalUser] = useState(() => getUser());
  const [token, setLocalToken] = useState(() => getToken());
  const [isAuthenticated, setIsAuthenticated] = useState(() => checkIsAuthenticated());
  const [isLoading, setIsLoading] = useState(true);

  // Synchronize user state
  const updateUser = useCallback((newUser) => {
    setUser(newUser);
    setLocalUser(newUser);
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearAuth();
      setLocalToken(null);
      setLocalUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  // Login
  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    if (!res.access_token) {
      throw new ApiError('No access token received from server.', 500);
    }
    setToken(res.access_token);
    setLocalToken(res.access_token);
    setIsAuthenticated(true);

    // Fetch user profile
    try {
      const me = await api.getMe();
      updateUser(me);
      return { token: res.access_token, user: me };
    } catch {
      return { token: res.access_token, user: null };
    }
  }, [updateUser]);

  // Register
  const register = useCallback(async (username, email, password) => {
    const res = await api.register(username, email, password);
    // Auto-login upon successful registration
    return await login(email, password);
  }, [login]);

  // Initial session restoration on mount
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      const storedToken = getToken();
      if (!storedToken) {
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        // Schedule proactive renewal
        scheduleTokenRefresh(storedToken, () => api.refreshToken());
        const me = await api.getMe();
        if (isMounted) {
          updateUser(me);
          setIsAuthenticated(true);
        }
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          clearAuth();
          if (isMounted) {
            setLocalToken(null);
            setLocalUser(null);
            setIsAuthenticated(false);
          }
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, [updateUser]);

  const value = {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
