import { ApiError } from "./errors";
import { mockRequest } from "./mockBackend";
import { readToken } from "./session";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Sem `VITE_API_URL` configurada, a aplicação roda contra o backend simulado. */
export const usingMockBackend = BASE_URL === "";

export type ApiRequest = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Envia o Bearer token da sessão. Ligado por padrão. */
  auth?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

/** A AuthProvider registra aqui o encerramento de sessão em respostas 401. */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function apiRequest<T>(
  path: string,
  { body, auth = true, headers, ...init }: ApiRequest = {},
): Promise<T> {
  if (usingMockBackend) {
    return mockRequest<T>(path, { body, method: init.method, signal: init.signal });
  }

  const token = auth ? readToken() : null;

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseBody(response);

  if (!response.ok) {
    if (response.status === 401 && auth) unauthorizedHandler?.();
    throw new ApiError(
      extractMessage(payload) ?? `Falha na requisição (${response.status}).`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown) {
  if (typeof payload === "string" && payload.trim() !== "") return payload;
  if (payload && typeof payload === "object") {
    const candidate = (payload as Record<string, unknown>).message;
    if (typeof candidate === "string") return candidate;
  }
  return null;
}
