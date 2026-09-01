const TOKEN_KEY = "alphractal.token";

export function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Modo privado ou storage bloqueado: a sessão vive só em memória.
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignorado
  }
}
