import { ApiError } from "./errors";
import { mockRequest } from "./mockBackend";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/**
 * URL absoluta de uma rota da API.
 *
 * O EventSource do SSE não passa pelo apiRequest -- ele abre a conexão
 * sozinho, com a URL completa -- então precisa desta montagem.
 */
export function urlDaApi(path: string): string {
  return `${BASE_URL}${path}`;
}

/** Sem `VITE_API_URL` configurada, a aplicação roda contra o backend simulado. */
export const usingMockBackend = BASE_URL === "";

export type ApiRequest = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export async function apiRequest<T>(
  path: string,
  { body, headers, ...init }: ApiRequest = {},
): Promise<T> {
  if (usingMockBackend) {
    return mockRequest<T>(path, { body, method: init.method, signal: init.signal });
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseBody(response);

  if (!response.ok) {
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

/**
 * Extrai a mensagem de erro do corpo da resposta.
 *
 * O backend responde em português e usa o campo `erro`, seguindo a convenção
 * do projeto -- `message` fica aqui só para compatibilidade com o que já
 * existia. Sem ler `erro`, mensagens úteis do backend (histórico defasado,
 * histórico insuficiente, entrada inválida) chegariam à tela como o genérico
 * "Falha na requisição (503)".
 */
function extractMessage(payload: unknown) {
  if (typeof payload === "string" && payload.trim() !== "") {
    // Página de erro do Express e afins vêm como HTML. Despejar isso na tela
    // não ajuda ninguém -- melhor cair no genérico com o código do status.
    if (payload.trimStart().startsWith("<")) return null;
    return payload;
  }
  if (payload && typeof payload === "object") {
    const corpo = payload as Record<string, unknown>;
    for (const campo of ["erro", "message", "detail"]) {
      const valor = corpo[campo];
      if (typeof valor === "string" && valor.trim() !== "") {
        // O 503 de histórico traz `como_resolver` com a saída prática; juntar
        // os dois evita que o usuário veja o problema sem a solução.
        const ajuda = corpo.como_resolver;
        return typeof ajuda === "string" ? `${valor} — ${ajuda}` : valor;
      }
    }
  }
  return null;
}
