import { endpoints } from "./endpoints";
import { ApiError } from "./errors";
import type {
  AnalysisAssets,
  Credentials,
  LoginResponse,
  Overview,
  Predictions,
  User,
} from "../types";

/**
 * Backend simulado usado enquanto `VITE_API_URL` não está configurada.
 * Serve para desenvolver a interface com estados reais de carregamento e erro.
 * Ao apontar para a API de verdade, este arquivo deixa de ser chamado.
 */

const LATENCY = 700;

const demoUser: User = {
  id: "usr_demo",
  name: "João Pedro",
  email: "joao@alphractal.com",
  plan: "Pro",
};

const overview: Overview = {
  updatedAt: new Date().toISOString(),
  metrics: [
    {
      id: "btc-dominance",
      label: "Dominância BTC",
      value: "54,2%",
      change: 0.8,
      hint: "Participação do Bitcoin na capitalização total",
    },
    {
      id: "funding",
      label: "Funding agregado",
      value: "0,012%",
      change: -0.4,
      hint: "Média ponderada das taxas de perpétuos",
    },
    {
      id: "netflow",
      label: "Netflow exchanges",
      value: "-8,4k BTC",
      change: 2.1,
      hint: "Saldo de entradas e saídas em 24h",
    },
    {
      id: "sentiment",
      label: "Sentimento",
      value: "Ganância",
      change: 5.6,
      hint: "Índice consolidado de medo e ganância",
    },
  ],
};

const analysisAssets: AnalysisAssets = {
  assets: [
    { id: "btc", symbol: "BTC", name: "Bitcoin", score: 78, trend: "up" },
    { id: "eth", symbol: "ETH", name: "Ethereum", score: 65, trend: "up" },
    { id: "sol", symbol: "SOL", name: "Solana", score: 52, trend: "flat" },
    { id: "link", symbol: "LINK", name: "Chainlink", score: 41, trend: "down" },
  ],
};

const predictions: Predictions = {
  generatedAt: new Date().toISOString(),
  items: [
    { id: "p1", asset: "BTC", horizon: "7 dias", direction: "up", confidence: 0.72 },
    { id: "p2", asset: "ETH", horizon: "7 dias", direction: "up", confidence: 0.64 },
    { id: "p3", asset: "SOL", horizon: "30 dias", direction: "down", confidence: 0.58 },
  ],
};

type MockOptions = {
  body?: unknown;
  method?: string;
  signal?: AbortSignal | null;
};

export async function mockRequest<T>(
  path: string,
  { body, signal }: MockOptions = {},
): Promise<T> {
  await delay(LATENCY, signal);

  switch (path) {
    case endpoints.login:
      return login(body) as T;
    case endpoints.logout:
      return null as T;
    case endpoints.me:
      return demoUser as T;
    case endpoints.overview:
      return { ...overview, updatedAt: new Date().toISOString() } as T;
    case endpoints.analysisAssets:
      return analysisAssets as T;
    case endpoints.predictions:
      return { ...predictions, generatedAt: new Date().toISOString() } as T;
    default:
      throw new ApiError(`Rota simulada não encontrada: ${path}`, 404);
  }
}

function login(body: unknown): LoginResponse {
  const { identifier, password } = (body ?? {}) as Partial<Credentials>;

  if (!identifier || !password) {
    throw new ApiError("Informe suas credenciais.", 400);
  }

  if (password.length < 6) {
    throw new ApiError("E-mail ou senha incorretos.", 401);
  }

  return {
    token: `mock.${btoa(identifier).replace(/=+$/, "")}`,
    user: { ...demoUser, email: identifier.includes("@") ? identifier : demoUser.email },
  };
}

function delay(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
