import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, SESSION_EXPIRED_EVENT, setSuppressSessionExpired } from "@/lib/api";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizeUrl,
} from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus = "unauthenticated" | "authenticated";

export interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
}

interface AuthContextValue extends AuthState {
  /** True while the initial token-refresh check is in flight. */
  isLoading: boolean;
  loginWithRedirect: () => Promise<void>;
  handleCallback: (code: string, codeVerifier: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Hook to consume the auth context. Must be used inside an `<AuthProvider>`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [authState, setAuthState] = useState<AuthState>({
    status: "unauthenticated",
    user: null,
  });

  // ---- Initial token refresh on mount via TanStack Query ----
  const { isLoading } = useQuery({
    queryKey: ["auth", "refresh"],
    queryFn: async () => {
      setSuppressSessionExpired(true);
      try {
        const data = await api.post<{ user: User }>("/auth/token/refresh");
        setAuthState({ status: "authenticated", user: data.user });
        return data;
      } finally {
        setSuppressSessionExpired(false);
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // ---- Session-expired listener ----
  const clearAuth = useCallback(() => {
    setAuthState({ status: "unauthenticated", user: null });
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [navigate, queryClient]);

  useEffect(() => {
    const handler = () => clearAuth();
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, [clearAuth]);

  // ---- Auth methods ----
  const loginWithRedirect = useCallback(async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    sessionStorage.setItem("pkce_code_verifier", verifier);
    sessionStorage.setItem("oauth_state", state);

    window.location.href = buildAuthorizeUrl(challenge, state);
  }, []);

  const handleCallback = useCallback(
    async (code: string, codeVerifier: string) => {
      const data = await api.post<{ user: User }>("/auth/callback", {
        code,
        code_verifier: codeVerifier,
      });
      setAuthState({ status: "authenticated", user: data.user });
    },
    [],
  );

  const logout = useCallback(async () => {
    const data = await api.post<{ logout_url: string }>("/auth/logout");
    setAuthState({ status: "unauthenticated", user: null });
    queryClient.clear();
    window.location.href = data.logout_url;
  }, [queryClient]);

  // ---- Memoised context value ----
  const value = useMemo<AuthContextValue>(
    () => ({
      ...authState,
      isLoading,
      loginWithRedirect,
      handleCallback,
      logout,
    }),
    [authState, isLoading, loginWithRedirect, handleCallback, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
