import { config } from "./config.js";

/**
 * Cotação ETH/USD, para converter custo de gas em dinheiro.
 *
 * Por que existe: o objetivo formal do projeto (TAP) é "converter dados brutos
 * da blockchain em indicadores financeiros instantâneos (USD)". gwei não diz
 * nada para quem decide; dólar diz.
 *
 * Onde ela NÃO entra: no modelo. A decisão 4 trata o câmbio como constante
 * dentro do horizonte, porque multiplicar a função objetivo por uma constante
 * não muda o argmin -- a alocação ótima é a mesma em ETH ou em USD. A cotação é
 * usada só na exibição, e é por isso que este módulo não é chamado pelo solver.
 */

/** Cotação vale por 60 s. Gas muda a cada 12 s; o preço do ETH, não tanto. */
const VALIDADE_MS = 60_000;

/** Sem cotação o painel ainda funciona em gwei -- não vale pendurar o pedido. */
const TIMEOUT_MS = 4_000;

export interface Cotacao {
  usd_por_eth: number;
  fonte: string;
  em: string;
}

let cache: { valor: Cotacao; expiraEm: number } | null = null;
let emVoo: Promise<Cotacao | null> | null = null;

/**
 * A chave da Alchemy já está na URL do RPC. Reaproveitá-la evita pedir ao
 * usuário uma segunda credencial só para cotação. Com outro provedor (Infura,
 * nó próprio) o padrão abaixo não casa e caímos no CoinGecko, que é público.
 */
function urlDaAlchemy(): string | null {
  const m = config.rpcHttpUrl.match(/alchemy\.com\/v2\/([A-Za-z0-9_-]+)/);
  return m ? `https://api.g.alchemy.com/prices/v1/${m[1]}/tokens/by-symbol?symbols=ETH` : null;
}

async function buscarNaAlchemy(url: string): Promise<number | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) return null;
  const corpo = await r.json() as { data?: { prices?: { currency?: string; value?: string }[] }[] };
  const preco = corpo.data?.[0]?.prices?.find((p) => p.currency?.toLowerCase() === "usd");
  const valor = Number(preco?.value);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

async function buscarNoCoinGecko(): Promise<number | null> {
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!r.ok) return null;
  const corpo = await r.json() as { ethereum?: { usd?: number } };
  const valor = Number(corpo.ethereum?.usd);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * Devolve a cotação, ou `null` se nenhuma fonte responder.
 *
 * `null` não é erro: quem chama exibe só gwei. Cotação indisponível não pode
 * derrubar o painel de gas, que é a função principal.
 */
export async function cotacaoEthUsd(): Promise<Cotacao | null> {
  if (cache && Date.now() < cache.expiraEm) return cache.valor;

  // Requisições concorrentes compartilham a mesma busca: com 3 rotas do painel
  // pedindo cotação ao mesmo tempo, seriam 3 chamadas externas idênticas.
  if (emVoo) return emVoo;

  emVoo = (async () => {
    const url = urlDaAlchemy();
    let valor: number | null = null;
    let fonte = "";

    try {
      if (url) {
        valor = await buscarNaAlchemy(url);
        fonte = "alchemy";
      }
      if (valor === null) {
        valor = await buscarNoCoinGecko();
        fonte = "coingecko";
      }
    } catch (erro) {
      console.error("[cotacao] falha ao buscar ETH/USD:", String(erro));
    }

    if (valor === null) {
      // Mantém a última cotação conhecida em vez de sumir com o dado: um preço
      // de minutos atrás é muito melhor que nenhum, e a queda de uma API
      // externa não deve apagar os valores em dólar da tela.
      return cache?.valor ?? null;
    }

    const cotacao: Cotacao = { usd_por_eth: valor, fonte, em: new Date().toISOString() };
    cache = { valor: cotacao, expiraEm: Date.now() + VALIDADE_MS };
    return cotacao;
  })();

  try {
    return await emVoo;
  } finally {
    emVoo = null;
  }
}

/** gwei por unidade de gas × gas consumido -> dólares. */
export function gweiParaUsd(gwei: number, usdPorEth: number): number {
  return (gwei / 1e9) * usdPorEth;
}
