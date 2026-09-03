import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As rotas dependem de banco, nó RPC, solver e cotação. Aqui interessa a camada
 * HTTP -- validação, CORS, a trava de defasagem -- então essas quatro são
 * substituídas. `app.ts` existe separado de `index.ts` justamente para poder ser
 * importado sem abrir porta nem ligar a ingestão.
 */
const serieHoraria = vi.fn();
const pool = { query: vi.fn() };
const otimizar = vi.fn();
const solverSaudavel = vi.fn();
const cotacaoEthUsd = vi.fn();

vi.mock("../src/db.js", () => ({
  pool,
  serieHoraria: (...a: unknown[]) => serieHoraria(...a),
  serieRecente: vi.fn(),
  serieHorariaBruta: vi.fn(),
  estatisticasDoDia: vi.fn(),
}));

vi.mock("../src/solver.js", async () => {
  const real = await vi.importActual<typeof import("../src/solver.js")>("../src/solver.js");
  return {
    ...real,   // preserva as classes de erro, que as rotas usam em `instanceof`
    otimizar: (...a: unknown[]) => otimizar(...a),
    solverSaudavel: () => solverSaudavel(),
  };
});

vi.mock("../src/cotacao.js", async () => {
  const real = await vi.importActual<typeof import("../src/cotacao.js")>("../src/cotacao.js");
  return { ...real, cotacaoEthUsd: () => cotacaoEthUsd() };
});

vi.mock("../src/rpc.js", () => ({ clienteHttp: { estimateGas: vi.fn() } }));

const { app } = await import("../src/app.js");
const { SolverIndisponivelError, SolverRecusouError } = await import("../src/solver.js");

/** Série horária terminando `horasAtras` atrás da hora cheia corrente. */
function serie(horas: number, horasAtras = 0) {
  const fim = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - horasAtras * 3_600_000);
  return Array.from({ length: horas }, (_, i) => ({
    momento: new Date(fim.getTime() - (horas - 1 - i) * 3_600_000),
    precoGwei: 0.1,
  }));
}

const RESPOSTA_SOLVER = {
  plano: [{ janela: 0, x: 50, custo_i_gwei: 0.1, custo_janela_gwei: 105_000 }],
  custo_total_gwei: 105_000,
  custo_baseline_t0_gwei: 105_000,
  economia_pct: 0,
  executar_agora: false,
  custo_distribuido_gwei: 105_000,
  teto_por_janela: 5,
  n_janelas: 24,
  aviso: null,
};

beforeEach(() => {
  serieHoraria.mockResolvedValue(serie(672));
  otimizar.mockResolvedValue(RESPOSTA_SOLVER);
  solverSaudavel.mockResolvedValue(true);
  cotacaoEthUsd.mockResolvedValue({ usd_por_eth: 2400, fonte: "teste", em: "2026-09-02T00:00:00Z" });
  pool.query.mockResolvedValue({ rows: [{ n: "1000", ultimo: new Date() }] });
});

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------

describe("CORS", () => {
  it("o preflight lista Authorization entre os cabeçalhos permitidos", async () => {
    // Regressão real: sem Authorization aqui, o navegador bloqueava TODA
    // chamada do painel antes de sair da máquina -- e curl não via nada,
    // porque curl não faz preflight.
    const r = await request(app).options("/otimizar");

    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(r.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("respostas normais carregam a origem liberada", async () => {
    const r = await request(app).get("/health");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("POST /otimizar — validação", () => {
  it.each([
    [{ horas_ate_deadline: 24, gas_used: 21000 }, "n_transacoes"],
    [{ n_transacoes: 0, horas_ate_deadline: 24, gas_used: 21000 }, "n_transacoes"],
    [{ n_transacoes: 1.5, horas_ate_deadline: 24, gas_used: 21000 }, "n_transacoes"],
    [{ n_transacoes: 50, gas_used: 21000 }, "horas_ate_deadline"],
    [{ n_transacoes: 50, horas_ate_deadline: 0, gas_used: 21000 }, "horas_ate_deadline"],
    [{ n_transacoes: 50, horas_ate_deadline: -1, gas_used: 21000 }, "horas_ate_deadline"],
    [{ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000, horas_historico: 12 }, "horas_historico"],
    [{ n_transacoes: 50, horas_ate_deadline: 24 }, "gas_used"],
    [{ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 0 }, "gas_used"],
  ])("recusa %j com 422 citando %s", async (corpo, campo) => {
    const r = await request(app).post("/otimizar").send(corpo);
    expect(r.status).toBe(422);
    expect(r.body.erro).toContain(campo);
    expect(otimizar).not.toHaveBeenCalled();
  });

  it("corpo vazio não derruba a rota", async () => {
    // express.json() precisa estar montado: sem ele req.body é undefined e a
    // primeira leitura lançaria TypeError em vez de responder 422.
    const r = await request(app).post("/otimizar").send();
    expect(r.status).toBe(422);
  });
});

describe("POST /otimizar — histórico", () => {
  it("recusa com 503 quando não há histórico suficiente", async () => {
    serieHoraria.mockResolvedValue(serie(12));
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    // A mensagem certa aqui é "insuficiente", não "defasado": a checagem de
    // tamanho vem antes da de idade justamente para isso.
    expect(r.status).toBe(503);
    expect(r.body.erro).toContain("insuficiente");
    expect(r.body.erro).not.toContain("defasado");
  });

  it("recusa quando o histórico está mais de 3 h atrasado", async () => {
    // O caso real: máquina desligada de madrugada. Sem a trava o plano saía
    // com HTTP 200 para uma janela que já passou, sem nenhum aviso.
    serieHoraria.mockResolvedValue(serie(672, 5));

    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    // 503 e não 422: o pedido está correto, quem não está pronto é o serviço.
    // Tentar de novo depois que a ingestão alcançar resolve, sem mudar nada
    // na chamada -- que é exatamente a semântica de 503.
    expect(r.status).toBe(503);
    expect(r.body.erro).toContain("defasado");
    expect(r.body.defasagem_horas).toBeGreaterThan(3);
    expect(r.body.como_resolver).toBeTruthy();
    expect(otimizar).not.toHaveBeenCalled();
  });

  it("aceita quando o histórico está dentro das 3 h", async () => {
    serieHoraria.mockResolvedValue(serie(672, 2));
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    expect(r.status).toBe(200);
    expect(otimizar).toHaveBeenCalled();
  });
});

describe("POST /otimizar — resposta", () => {
  it("acrescenta a conversão em dólar ao que o solver devolveu", async () => {
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    expect(r.status).toBe(200);
    expect(r.body.usd_por_eth).toBe(2400);
    // 105.000 gwei = 0,000105 ETH; a US$ 2.400 -> US$ 0,252
    expect(r.body.custo_total_usd).toBeCloseTo(0.252, 6);
    expect(r.body.custo_distribuido_usd).toBeCloseTo(0.252, 6);
    expect(r.body.historico_horas).toBe(672);
  });

  it("deixa os campos em dólar nulos quando não há cotação", async () => {
    cotacaoEthUsd.mockResolvedValue(null);
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    expect(r.status).toBe(200);
    expect(r.body.usd_por_eth).toBeNull();
    expect(r.body.custo_total_usd).toBeNull();
    // O plano em gwei continua inteiro: cotação fora do ar não tira o produto.
    expect(r.body.custo_total_gwei).toBe(105_000);
  });

  it("propaga 422 quando o solver recusa o pedido", async () => {
    otimizar.mockRejectedValue(new SolverRecusouError("historico tem buraco"));
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    expect(r.status).toBe(422);
    expect(r.body.erro).toContain("buraco");
  });

  it("devolve 503 quando o solver está fora do ar", async () => {
    // 503 e não 500: é infraestrutura, não pedido inválido -- a distinção
    // decide se o cliente deve corrigir a entrada ou tentar de novo.
    otimizar.mockRejectedValue(new SolverIndisponivelError("connect ECONNREFUSED"));
    const r = await request(app)
      .post("/otimizar")
      .send({ n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 });

    expect(r.status).toBe(503);
  });
});

describe("GET /health", () => {
  it("relata banco, ingestão e solver", async () => {
    const r = await request(app).get("/health");

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", blocos: 1000, solver: "ok" });
    expect(r.body.defasagem_minutos).toBeLessThan(1);
  });

  it("marca o solver como inalcançável sem derrubar a rota", async () => {
    solverSaudavel.mockResolvedValue(false);
    const r = await request(app).get("/health");

    expect(r.status).toBe(200);
    expect(r.body.solver).toBe("inalcancavel");
  });

  it("devolve 503 quando o banco não responde", async () => {
    pool.query.mockRejectedValue(new Error("connection refused"));
    const r = await request(app).get("/health");

    expect(r.status).toBe(503);
    expect(r.body.status).toBe("degradado");
  });
});

// ---------------------------------------------------------------------------

describe("regressão: o solver é determinístico", () => {
  it("chamadas idênticas devolvem exatamente o mesmo plano", async () => {
    // Um usuário relatou "zero de economia duas vezes com valores diferentes" e
    // a primeira hipótese foi não-determinismo no ajuste do Holt-Winters. Não
    // era -- a série tinha avançado uma hora entre as chamadas. Este teste trava
    // a propriedade para a hipótese não precisar ser reinvestigada.
    const corpo = { n_transacoes: 50, horas_ate_deadline: 24, gas_used: 21000 };
    const [a, b, c] = await Promise.all([
      request(app).post("/otimizar").send(corpo),
      request(app).post("/otimizar").send(corpo),
      request(app).post("/otimizar").send(corpo),
    ]);

    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
  });
});
