import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { onUnauthorized } from "../lib/api";
import { clearToken, readToken, writeToken } from "../lib/session";
import type { Credentials, User } from "../types";
import { AuthContext, type AuthStatus } from "./AuthContext";
import { authService } from "./authService";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Sem token salvo não há o que restaurar: já começa como visitante.
  const [status, setStatus] = useState<AuthStatus>(() =>
    readToken() ? "loading" : "guest",
  );

  useEffect(() => {
    onUnauthorized(() => {
      clearToken();
      setUser(null);
      setStatus("guest");
    });
  }, []);

  useEffect(() => {
    if (!readToken()) return;

    let active = true;

    authService
      .me()
      .then((restored) => {
        if (!active) return;
        setUser(restored);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        clearToken();
        setStatus("guest");
      });

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (credentials: Credentials) => {
    const session = await authService.login(credentials);
    writeToken(session.token);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    await authService.logout();
    clearToken();
    setUser(null);
    setStatus("guest");
  }, []);

  const value = useMemo(
    () => ({ user, status, signIn, signOut }),
    [user, status, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
