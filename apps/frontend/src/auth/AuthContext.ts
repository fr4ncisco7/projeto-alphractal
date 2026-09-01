import { createContext } from "react";
import type { Credentials, User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "guest";

export type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
