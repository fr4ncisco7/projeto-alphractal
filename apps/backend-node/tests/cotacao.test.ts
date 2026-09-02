import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O módulo guarda cache e requisição em voo no escopo do módulo, e a URL da
 * Alchemy sai de `config`, que lê `process.env` no import. Por isso cada teste
 * reimporta o módulo com o ambiente já ajustado, em vez de importar no topo.
 */
async function carregarCotacao(rpcHttpUrl: string) {
  vi.resetModules();
  process.env.RPC_HTTP_URL = rpcHttpUrl;
  return import("../src/cotacao.js");
}

const RPC_ALCHEMY = "https://eth-mainnet.g.alchemy.com/v2/chave_de_teste";
const RPC_SEM_ALCHEMY = "https://ethereum-rpc.publicnode.com";

function respostaAlchemy(valor: string) {
  return {
    ok: true,
    json: async () => ({ data: [{ prices: [{ currency: "USD", value: valor }] }] }),
  };
}

function respostaCoinGecko(valor: number) {
  return { ok: true, json: async () => ({ ethereum: { usd: valor } }) };
}

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cotação ETH/USD", () => {
  it("usa a chave da Alchemy extraída da URL do RPC", async () => {
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso.mockResolvedValueOnce(respostaAlchemy("2408.54"));

    const c = await cotacaoEthUsd();

    expect(c).toMatchObject({ usd_por_eth: 2408.54, fonte: "alchemy" });
    // A chave da URL do RPC é reaproveitada -- é o motivo de o usuário não
    // precisar de uma segunda credencial só para cotação.
    expect(fetchFalso.mock.calls[0][0]).toContain("chave_de_teste");
  });

  it("cai no CoinGecko quando o RPC não é da Alchemy", async () => {
    const { cotacaoEthUsd } = await carregarCotacao(RPC_SEM_ALCHEMY);
    fetchFalso.mockResolvedValueOnce(respostaCoinGecko(2390));

    const c = await cotacaoEthUsd();

    expect(c).toMatchObject({ usd_por_eth: 2390, fonte: "coingecko" });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0][0]).toContain("coingecko");
  });

  it("cai no CoinGecko quando a Alchemy responde erro", async () => {
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(respostaCoinGecko(2375));

    expect(await cotacaoEthUsd()).toMatchObject({ usd_por_eth: 2375, fonte: "coingecko" });
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("devolve null quando nenhuma fonte responde e não há cache", async () => {
    // `null` não é erro: o painel exibe gwei. Cotação fora do ar não pode
    // derrubar o monitor de gas, que é a função principal.
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso.mockRejectedValue(new Error("rede fora"));

    expect(await cotacaoEthUsd()).toBeNull();
  });

  it("serve do cache dentro dos 60 s, sem nova chamada externa", async () => {
    vi.useFakeTimers();
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso.mockResolvedValue(respostaAlchemy("2400"));

    await cotacaoEthUsd();
    vi.advanceTimersByTime(59_000);
    await cotacaoEthUsd();

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("busca de novo depois dos 60 s", async () => {
    vi.useFakeTimers();
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso.mockResolvedValue(respostaAlchemy("2400"));

    await cotacaoEthUsd();
    vi.advanceTimersByTime(61_000);
    await cotacaoEthUsd();

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("mantém a última cotação conhecida quando a fonte cai", async () => {
    // Um preço de minutos atrás é muito melhor que nenhum: sem isto, a queda
    // de uma API externa apagaria todos os valores em dólar da tela.
    vi.useFakeTimers();
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);

    fetchFalso.mockResolvedValueOnce(respostaAlchemy("2400"));
    await cotacaoEthUsd();

    vi.advanceTimersByTime(61_000);
    fetchFalso.mockRejectedValue(new Error("rede fora"));

    expect(await cotacaoEthUsd()).toMatchObject({ usd_por_eth: 2400 });
    vi.useRealTimers();
  });

  it("requisições concorrentes compartilham uma única busca", async () => {
    // Três rotas do painel pedem cotação ao mesmo tempo; sem o
    // compartilhamento seriam três chamadas externas idênticas.
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    let liberar!: (v: unknown) => void;
    const presa = new Promise((r) => { liberar = r; });
    fetchFalso.mockImplementation(async () => { await presa; return respostaAlchemy("2411"); });

    const pedidos = Promise.all([cotacaoEthUsd(), cotacaoEthUsd(), cotacaoEthUsd()]);
    liberar(null);
    const [a, b, c] = await pedidos;

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect([a, b, c].every((x) => x?.usd_por_eth === 2411)).toBe(true);
  });

  it("rejeita valores não positivos ou não numéricos da fonte", async () => {
    const { cotacaoEthUsd } = await carregarCotacao(RPC_ALCHEMY);
    fetchFalso
      .mockResolvedValueOnce(respostaAlchemy("0"))          // Alchemy devolve 0
      .mockResolvedValueOnce(respostaCoinGecko(2350));      // cai para o fallback

    expect(await cotacaoEthUsd()).toMatchObject({ usd_por_eth: 2350, fonte: "coingecko" });
  });
});

describe("gweiParaUsd", () => {
  it("converte gwei por unidade de gas em dólares", async () => {
    const { gweiParaUsd } = await carregarCotacao(RPC_ALCHEMY);
    // 21.000 de gas a 0,1 gwei = 0,0000021 ETH; a US$ 2.400 -> US$ 0,00504
    expect(gweiParaUsd(21_000 * 0.1, 2400)).toBeCloseTo(0.00504, 9);
  });

  it("é linear na cotação", async () => {
    const { gweiParaUsd } = await carregarCotacao(RPC_ALCHEMY);
    expect(gweiParaUsd(1000, 4000)).toBeCloseTo(2 * gweiParaUsd(1000, 2000), 12);
  });
});
