import { getCurrentAuthUser, logout as revokeSession, setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { clearCredential, readCredential, writeCredential } from "@/lib/credentials";

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

setAuthTokenGetter(() => _currentToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAuth() {
      try {
        const storedToken = await readCredential();
        if (storedToken) {
          _currentToken = storedToken;
          const current = await getCurrentAuthUser();
          if (current.user?.id && current.user.email) {
            setToken(storedToken);
            setUser({
              id: current.user.id,
              email: current.user.email,
              firstName: current.user.firstName ?? null,
              lastName: current.user.lastName ?? null,
              role: current.user.role ?? null,
            });
          } else {
            _currentToken = null;
            await clearCredential();
          }
        }
      } catch {
        // A saved bearer token is not evidence of an active session. Keep it
        // protected for a possible network retry, but don't unlock cached data.
        _currentToken = null;
        setToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, []);

  const login = async (newToken: string, newUser: AuthUser) => {
    await writeCredential(newToken);
    queryClient.clear();
    _currentToken = newToken;
    setToken(newToken);
    setUser(newUser);
  };

  const logout = async () => {
    try {
      if (_currentToken) await revokeSession();
    } finally {
      _currentToken = null;
      setToken(null);
      setUser(null);
      queryClient.clear();
      await clearCredential();
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
