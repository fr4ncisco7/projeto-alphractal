import { apiRequest } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import type { Credentials, LoginResponse, User } from "../types";

export const authService = {
  login: (credentials: Credentials) =>
    apiRequest<LoginResponse>(endpoints.login, {
      body: credentials,
      auth: false,
    }),

  me: () => apiRequest<User>(endpoints.me),

  /** O logout no servidor é best-effort: a sessão local é limpa de qualquer forma. */
  logout: () =>
    apiRequest<null>(endpoints.logout, { method: "POST" }).catch(() => null),
};
