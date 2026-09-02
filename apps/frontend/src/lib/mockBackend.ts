import { endpoints } from "./endpoints";
import { ApiError } from "./errors";
import type {
  EstatisticasDia,
  Otimizacao,
  PedidoOtimizacao,
  PontoSerie,
  Saude,
} from "../types";

/**
 * Backend simulado, usado enquanto `VITE_API_URL` não está configurada.
 *
 * Serve para desenvolver e demonstrar a interface sem depender de Docker, do
 * banco ou do nó Ethereum. Os números são gerados com a mesma forma do gas
 * real -- pico no meio do dia, desconto de fim de semana, cauda pesada
 * ocasional -- e na mesma escala observada hoje na mainnet (dezenas de
 * milésimos de gwei), para o layout ser exercitado com valores plausíveis.
 *
 * Não substitui o backend: o otimizador daqui é uma heurística de mentira, só
 * para a tela ter o que desenhar. O MILP de verdade roda no solver.
 */

const LATENCIA = 450;

/** Preço-base em gwei. Perto do que a mainnet pratica hoje. */
const BASE_GWEI = 0.062;

/** Cotação fixa no mock: sem backend não há de onde buscar, e um valor
 *  plausível deixa a interface exercitada com números realistas. */
const USD_POR_ETH = 2460;

/** Transferência simples de ETH. Mesmo valor que o backend usa. */
const GAS_REFERENCIA = 21_000;

/** Fator multiplicativo por hora do dia: pico às 14h UTC, vale de madrugada. */
function fatorHora(hora: number): number {
  return 1 + 0.8 * Math.exp(-0.5 * ((hora - 14) / 4) ** 2);
}

/** Fim de semana é mais barato -- mesmo efeito que o estimador procura. */
function fatorDia(diaDaSemana: number): number {
  return diaDaSemana === 0 || diaDaSemana === 6 ? 0.62 : 1;
}

/**
 * Ruído determinístico por timestamp.
 *
 * Determinístico de propósito: com Math.random() o gráfico mudaria de forma a
 * cada render e a cada recarga, o que atrapalha tanto o desenvolvimento quanto
 * uma demonstração. Aqui o mesmo instante devolve sempre o mesmo valor.
 */
function ruido(ms: number): number {
  const x = Math.sin(ms / 60000) * 10000;
  return 0.88 + (x - Math.floor(x)) * 0.24;
}

function precoEm(data: Date): number {
  return BASE_GWEI * fatorHora(data.getUTCHours()) * fatorDia(data.getUTCDay()) * ruido(data.getTime());
}

function ponto(data: Date, blocos: number): PontoSerie {
  const media = precoEm(data);
  const base = media * 0.82;
  return {
    momento: data.toISOString(),
    media_gwei: media,
    mediana_gwei: media * 0.96,
    minimo_gwei: media * 0.71,
    maximo_gwei: media * 1.46,
    base_fee_media_gwei: base,
    gas_used_ratio_medio: 0.35 + (ruido(data.getTime()) - 0.88) * 1.8,
    blocos,
  };
}

function serie(passoMinutos: number, quantidade: number, blocosPorPonto: number): PontoSerie[] {
  const agora = Date.now();
  const passo = passoMinutos * 60_000;
  const fim = Math.floor(agora / passo) * passo;
  return Array.from({ length: quantidade }, (_, i) =>
    ponto(new Date(fim - (quantidade - 1 - i) * passo), blocosPorPonto),
  );
}

function estatisticas(): EstatisticasDia {
  const inicioDoDia = new Date();
  inicioDoDia.setUTCHours(0, 0, 0, 0);

  const horasDecorridas = Math.max(1, new Date().getUTCHours());
  const amostra = Array.from({ length: horasDecorridas * 12 }, (_, i) =>
    precoEm(new Date(inicioDoDia.getTime() + i * 5 * 60_000)),
  ).sort((a, b) => a - b);

  const soma = amostra.reduce((t, v) => t + v, 0);
  return {
    desde: inicioDoDia.toISOString(),
    blocos: horasDecorridas * 300,
    media_gwei: soma / amostra.length,
    mediana_gwei: amostra[Math.floor(amostra.length / 2)],
    // Mesma ideia do backend: centro da faixa mais populosa entre mín e máx.
    moda_gwei: amostra[Math.floor(amostra.length * 0.38)],
    minimo_gwei: amostra[0],
    maximo_gwei: amostra[amostra.length - 1],
    congestionamento_medio: 0.46,
    usd_por_eth: USD_POR_ETH,
    cotacao_em: new Date().toISOString(),
    gas_referencia: GAS_REFERENCIA,
    custo_referencia_usd:
      (amostra[Math.floor(amostra.length / 2)] * GAS_REFERENCIA / 1e9) * USD_POR_ETH,
  };
}

function otimizar(pedido: PedidoOtimizacao): Otimizacao {
  const n = Number(pedido.n_transacoes);
  const gasUsed = Number(pedido.gas_used ?? 21_000);
  const janelas = Math.floor(Number(pedido.horas_ate_deadline));

  if (!Number.isInteger(n) || n < 1) throw new ApiError("n_transacoes precisa ser inteiro >= 1", 422);
  if (janelas < 1) {
    throw new ApiError(
      `horizonte de ${pedido.horas_ate_deadline}h trunca para 0 janelas de 1h; execute imediatamente`,
      422,
    );
  }

  const agora = new Date();
  const inicio = new Date(Math.floor(agora.getTime() / 3_600_000) * 3_600_000);
  const custos = Array.from({ length: janelas }, (_, i) =>
    precoEm(new Date(inicio.getTime() + i * 3_600_000)),
  );

  // Heurística: enche as janelas mais baratas até o teto, na ordem de preço.
  // O MILP de verdade é resolvido pelo solver; aqui basta o formato bater.
  const teto = Math.max(Math.ceil(0.3 * n), Math.ceil(n / janelas));
  const ordem = custos.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
  const x = new Array<number>(janelas).fill(0);
  let restantes = n;
  for (const { i } of ordem) {
    const posto = Math.min(teto, restantes);
    x[i] = posto;
    restantes -= posto;
    if (restantes === 0) break;
  }

  const custoTotal = x.reduce((t, xi, i) => t + xi * gasUsed * custos[i], 0);
  const baseline = n * gasUsed * custos[0];

  const historicoHoras = 672;
  return {
    plano: custos.map((c, i) => ({
      janela: i,
      x: x[i],
      custo_i_gwei: c,
      custo_janela_gwei: x[i] * gasUsed * c,
    })),
    custo_total_gwei: custoTotal,
    custo_baseline_t0_gwei: baseline,
    economia_pct: 100 * (1 - custoTotal / baseline),
    teto_por_janela: teto,
    n_janelas: janelas,
    aviso: null,
    historico_horas: historicoHoras,
    historico_de: new Date(inicio.getTime() - historicoHoras * 3_600_000).toISOString(),
    historico_ate: new Date(inicio.getTime() - 3_600_000).toISOString(),
    usd_por_eth: USD_POR_ETH,
    custo_total_usd: (custoTotal / 1e9) * USD_POR_ETH,
    custo_baseline_t0_usd: (baseline / 1e9) * USD_POR_ETH,
    economia_usd: ((baseline - custoTotal) / 1e9) * USD_POR_ETH,
  };
}

const saude: Saude = {
  status: "ok",
  blocos: 27_900,
  ultimo_bloco_em: new Date().toISOString(),
  defasagem_minutos: 0.2,
  ingestao: "ativa",
  solver: "ok",
  assinantes_sse: 0,
};

type OpcoesMock = {
  body?: unknown;
  method?: string;
  signal?: AbortSignal | null;
};

export async function mockRequest<T>(
  caminho: string,
  { body, signal }: OpcoesMock = {},
): Promise<T> {
  await espera(LATENCIA, signal);

  // O caminho pode vir com query string (?minutos=180); a rota é só a base.
  const [rota, query] = caminho.split("?");
  const params = new URLSearchParams(query ?? "");

  switch (rota) {
    case endpoints.saude:
      return { ...saude, ultimo_bloco_em: new Date().toISOString() } as T;

    case endpoints.gasRecente: {
      const minutos = Number(params.get("minutos") ?? 180);
      return { minutos, pontos: minutos, serie: serie(1, minutos, 5) } as unknown as T;
    }

    case endpoints.cotacao:
      return { usd_por_eth: USD_POR_ETH, fonte: "simulado", em: new Date().toISOString() } as T;

    case endpoints.gasEstatisticas:
      return estatisticas() as T;

    case endpoints.gasCalendario: {
      const dias = Number(params.get("dias") ?? 7);
      const pontos = dias * 24;
      return { dias, pontos, serie: serie(60, pontos, 300) } as unknown as T;
    }

    case endpoints.otimizar:
      return otimizar((body ?? {}) as PedidoOtimizacao) as T;

    default:
      throw new ApiError(`Rota simulada não encontrada: ${rota}`, 404);
  }
}

function espera(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aoAbortar);
      resolve();
    }, ms);
    function aoAbortar() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", aoAbortar, { once: true });
  });
}

/** Tipos exportados só para o mock do stream, em `useStreamBlocos`. */
export { precoEm as precoSimuladoEm };
