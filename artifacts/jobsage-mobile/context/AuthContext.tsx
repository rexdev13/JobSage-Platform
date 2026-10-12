import { getCurrentAuthUser, logout as revokeSession, setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { clearCredential, readCredential, writeCredential } from "@/lib/credentials";
import { NativeSessionLifecycle } from "@/lib/native-session-lifecycle";

interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

let _currentToken: string | null = null;
let _currentUserId: string | null = null;
let _authRevision = 0;

/** Native-only capability check for asynchronous operations across sign-out. */
export function getNativeSessionToken() { return _currentToken; }
export function getNativeSessionUserId() { return _currentUserId; }
export function getNativeAuthRevision() { return _authRevision; }

setAuthTokenGetter(() => _currentToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const lifecycle = useRef<NativeSessionLifecycle<AuthUser> | null>(null);
  if (!lifecycle.current) lifecycle.current = new NativeSessionLifecycle<AuthUser>({
    read: readCredential, write: writeCredential, clear: clearCredential,
    started: () => { ++_authRevision; },
    changed: (session, loading) => {
      const changedAccount = _currentToken !== (session?.token ?? null) || _currentUserId !== (session?.user.id ?? null);
      _currentToken = session?.token ?? null;
      _currentUserId = session?.user.id ?? null;
      if (changedAccount) queryClient.clear();
      setToken(_currentToken); setUser(session?.user ?? null); setIsLoading(loading);
    },
    validate: async (storedToken, signal) => {
      const { user: current } = await getCurrentAuthUser({
        signal, cache: "no-store", headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!current?.id || !current.email) return null;
      return { id: current.id, email: current.email, firstName: current.firstName ?? null, lastName: current.lastName ?? null, role: current.role ?? null };
    },
    revoke: async (capturedToken) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        await revokeSession({ signal: controller.signal, headers: { Authorization: `Bearer ${capturedToken}` } });
      } finally { clearTimeout(timer); }
    },
  });
  useEffect(() => {
    const scope = lifecycle.current!;
    void scope.bootstrap().catch(() => {
      // Keystore failure remains locked; no plaintext fallback.
    });
    return () => {
      scope.stop(); _currentToken = null; _currentUserId = null;
    };
  }, []);

  const login = (newToken: string, newUser: AuthUser) => lifecycle.current!.login(newToken, newUser);
  const logout = () => lifecycle.current!.logout();

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
