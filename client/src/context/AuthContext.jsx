import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints.js';
import { refreshSession, setAccessToken, setAuthLostHandler } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // 'loading' while we check for an existing session, so protected pages do not flash the login screen.
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    setAuthLostHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });

    // Restore the session after a page load: the refresh cookie (if any) yields a new access token.
    // refreshSession() is shared, so React StrictMode's double effect still makes a single request.
    refreshSession()
      .then((session) => {
        setUser(session.user);
        setStatus('authenticated');
      })
      .catch(() => {}); // not signed in: the auth-lost handler already set 'anonymous'
  }, []);

  const startSession = useCallback((session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const login = useCallback(async (credentials) => startSession(await authApi.login(credentials)), [startSession]);
  const register = useCallback(async (details) => startSession(await authApi.register(details)), [startSession]);

  const logout = useCallback(async ({ everywhere = false } = {}) => {
    try {
      await (everywhere ? authApi.logoutAll() : authApi.logout());
    } catch {
      // Signing out locally must always work, even if the network call fails.
    }
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
