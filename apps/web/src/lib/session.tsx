'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { AuthPrincipal, Role } from '@campusconnect/shared';
import { ROLE_HOME } from '@campusconnect/shared';
import { api, ApiError, setAccessToken } from './api';

/**
 * Session context.
 *
 * Holds the current user in memory and exposes imperative `signIn`/`signOut`.
 *
 * On mount, the provider silently calls `/auth/me`. That is what re-establishes a
 * session after a page reload: the access token is in memory only (see `api.ts`),
 * but the httpOnly refresh cookie lets the client mint a new one without the user
 * seeing a login screen.
 */

export type SessionUser = AuthPrincipal & {
  avatarUrl?: string | null;
  collegeName?: string | null;
};

type SessionState = {
  user: SessionUser | null;
  /** True until the initial `/auth/me` call settles. */
  loading: boolean;
  error: string | null;
};

type SessionContextValue = SessionState & {
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<SessionUser>;
  signUp: (input: Record<string, unknown>) => Promise<SessionUser>;
  signOut: (options?: { allDevices?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  /** Where this user's dashboard lives. */
  homePath: string;
  hasRole: (...roles: Role[]) => boolean;
};

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [state, setState] = React.useState<SessionState>({
    user: null,
    loading: true,
    error: null,
  });

  const loadSession = React.useCallback(async () => {
    try {
      const result = await api<{ user: SessionUser }>('/auth/me', {
        // A 401 here is expected for a signed-out visitor, not an error worth
        // surfacing. Handled below rather than thrown.
        anonymous: false,
      });

      setState({ user: result.user, loading: false, error: null });
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        setState({ user: null, loading: false, error: null });
        return;
      }

      // A network failure at boot should not block the whole app — the public
      // pages still work, so we record the error and carry on signed out.
      setState({
        user: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not reach the server',
      });
    }
  }, []);

  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const signIn = React.useCallback(
    async (email: string, password: string, rememberMe = false): Promise<SessionUser> => {
      const result = await api<{ user: SessionUser; accessToken: string; home: string }>('/auth/login', {
        method: 'POST',
        body: { email, password, rememberMe },
        anonymous: true,
      });

      setAccessToken(result.accessToken);
      setState({ user: result.user, loading: false, error: null });

      return result.user;
    },
    [],
  );

  const signUp = React.useCallback(async (input: Record<string, unknown>): Promise<SessionUser> => {
    const result = await api<{ user: SessionUser; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: input,
      anonymous: true,
    });

    setAccessToken(result.accessToken);
    setState({ user: result.user, loading: false, error: null });

    return result.user;
  }, []);

  const signOut = React.useCallback(
    async (options: { allDevices?: boolean } = {}) => {
      try {
        await api('/auth/logout', { method: 'POST', body: options });
      } catch {
        // A failed logout call should still clear local state — leaving the user
        // apparently signed in because the network blipped is worse.
      }

      setAccessToken(null);
      setState({ user: null, loading: false, error: null });
      router.push('/login');
      router.refresh();
    },
    [router],
  );

  const refresh = React.useCallback(async () => {
    await loadSession();
  }, [loadSession]);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      ...state,
      signIn,
      signUp,
      signOut,
      refresh,
      homePath: state.user ? (ROLE_HOME[state.user.role] ?? '/dashboard') : '/login',
      hasRole: (...roles: Role[]) => Boolean(state.user && roles.includes(state.user.role)),
    }),
    [state, signIn, signUp, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/**
 * Convenience hook for a component that requires a signed-in user.
 *
 * Redirects to login with a `next` parameter so the user lands back where they
 * were trying to go, rather than on the dashboard.
 */
export function useRequireAuth(options: { redirectTo?: string } = {}) {
  const { user, loading } = useSession();
  const router = useRouter();

  React.useEffect(() => {
    if (loading || user) return;

    const target = options.redirectTo ?? window.location.pathname + window.location.search;
    router.push(`/login?next=${encodeURIComponent(target)}`);
  }, [loading, user, router, options.redirectTo]);

  return { user, loading, isAuthenticated: Boolean(user) };
}
