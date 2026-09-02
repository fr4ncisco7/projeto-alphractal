import express from "express";
import { config } from "./config.js";
import {
  estatisticasDoDia,
  pool,
  serieHoraria,
  serieHorariaBruta,
  serieRecente,
} from "./db.js";
import { cotacaoEthUsd, gweiParaUsd } from "./cotacao.js";
import { assinar, totalAssinantes } from "./eventos.js";
import { iniciarIngestaoAoVivo } from "./ingestao.js";
import { clienteHttp } from "./rpc.js";
import {
  SolverIndisponivelError,
  SolverRecusouError,
  otimizar,
  solverSaudavel,
} from "./solver.js";

const app = express();
app.use(express.json({ limit: "4mb" }));   // 4 semanas de série ~ 700 pontos

/**
 * CORS liberado. O frontend roda em outra origem (o Vite sobe em :5173, o
 * backend em :3000), e sem estes cabeçalhos o navegador bloqueia toda chamada
 * antes mesmo de sair da máquina.
 *
 * Escrito à mão em vez de instalar o pacote `cors`: são seis linhas e uma
 * dependência a menos. O `*` é adequado enquanto a API é pública e sem
 * autenticação -- no dia em que houver login com cookie ou token, isto precisa
 * virar uma lista de origens permitidas, porque `*` é incompatível com
 * credenciais.
 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Authorization precisa estar aqui mesmo sem o backend usar o token: o
  // frontend é a casca da plataforma Alphractal e manda o Bearer da sessão
  // simulada em toda chamada. Um cabeçalho não listado faz o preflight
  // falhar, e o navegador bloqueia a requisição antes de ela sair.
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** Teto de janela nas leituras, para uma URL curiosa não varrer a hypertable. */
const MAX_MINUTOS = 60 * 24 * 7;   // 7 dias em minutos
const MAX_DIAS = 90;

/**
 * Gas de referência para expressar o preço em dinheiro.
 *
 * gwei é preço POR UNIDADE de gas, não um valor -- "0,12 gwei" não tem
 * conversão direta para dólar. Para virar dinheiro é preciso multiplicar pelo
 * gas que a transação consome, e isso exige escolher uma transação de
 * referência. 21.000 é o custo fixo de uma transferência simples de ETH: o
 * menor valor possível e o mais reconhecível. Uma swap consome ~150.000, então
 * o número exibido é um piso, não uma média de uso real.
 */
const GAS_REFERENCIA = 21_000;

function inteiroNaFaixa(valor: unknown, padrao: number, min: number, max: number): number {
  const n = Number(valor ?? padrao);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Mesmo mínimo que o solver exige: 2 ciclos sazonais de 24h. Checamos aqui
 *  também para dar a mensagem certa -- o solver não sabe do limite do RPC. */
const MINIMO_HORAS_HISTORICO = 48;

/** Quanto histórico pedir ao banco. 4 semanas é o recomendado pela decisão 8
 *  para o fator de dia da semana. Pedir mais que existe não é erro: a série
 *  volta menor e o solver avisa. */
const HORAS_HISTORICO_PADRAO = 672;

/**
 * Defasagem máxima tolerada entre o fim da série e agora.
 *
 * O solver prevê a partir da hora SEGUINTE ao último ponto do histórico. Se a
 * série estiver velha, a "janela 0" do plano cai no passado e a recomendação é
 * para um período que já terminou -- devolvida com status 200, sem nada
 * indicando o problema. Foi exatamente o que aconteceu depois de uma noite com
 * a máquina desligada: 24,5h de defasagem, plano para o dia anterior.
 *
 * O valor precisa ser maior que 2h, e isso não é folga arbitrária: a série
 * termina na última hora CHEIA, então às 10h59 o último ponto é o das 09h00 --
 * 1h59 de idade mesmo com a ingestão perfeita. Um limite de 2h dispararia
 * falso positivo todo fim de hora. 3h dá uma hora de margem real.
 */
const MAX_DEFASAGEM_HORAS = 3;

app.get("/health", async (_req, res) => {
  try {
    const [r, solverOk] = await Promise.all([
      pool.query<{ n: string; ultimo: Date | null }>(
        "SELECT count(*)::text AS n, max(momento) AS ultimo FROM bloco_gas",
      ),
      solverSaudavel(),
    ]);
    res.json({
      status: "ok",
      blocos: Number(r.rows[0].n),
      ultimo_bloco_em: r.rows[0].ultimo,
      defasagem_minutos: r.rows[0].ultimo
        ? Number(((Date.now() - r.rows[0].ultimo.getTime()) / 60_000).toFixed(1))
        : null,
      ingestao: config.ingestaoAtiva ? "ativa" : "desligada",
      solver: solverOk ? "ok" : "inalcancavel",
      assinantes_sse: totalAssinantes(),
    });
  } catch (erro) {
    res.status(503).json({ status: "degradado", erro: String(erro) });
  }
});

/**
 * GET /gas/recente?minutos=180 -- série de 1 minuto para o gráfico ao vivo.
 *
 * Devolve o histórico; o tempo real vem depois pelo /stream. O painel usa os
 * dois juntos: carrega a série ao abrir e vai anexando os blocos que chegam.
 */
app.get("/gas/recente", async (req, res) => {
  try {
    const minutos = inteiroNaFaixa(req.query.minutos, 180, 1, MAX_MINUTOS);
    const serie = await serieRecente(minutos);
    res.json({ minutos, pontos: serie.length, serie });
  } catch (erro) {
    console.error("[gas/recente]", erro);
    res.status(500).json({ erro: String(erro) });
  }
});

/** GET /gas/estatisticas -- média, mediana e moda do dia (pedido do parceiro). */
app.get("/gas/estatisticas", async (_req, res) => {
  try {
    // Em paralelo: a cotação vem de uma API externa e não deve somar sua
    // latência à da consulta ao banco.
    const [estatisticas, cotacao] = await Promise.all([estatisticasDoDia(), cotacaoEthUsd()]);

    res.json({
      ...estatisticas,
      usd_por_eth: cotacao?.usd_por_eth ?? null,
      cotacao_em: cotacao?.em ?? null,
      gas_referencia: GAS_REFERENCIA,
      // Custo em dólar de UMA transferência simples ao preço mediano do dia.
      // Mediana e não média: um pico de congestionamento distorce a média, e a
      // pergunta aqui é "quanto costuma custar", não "qual a média aritmética".
      custo_referencia_usd:
        cotacao && estatisticas.mediana_gwei !== null
          ? gweiParaUsd(estatisticas.mediana_gwei * GAS_REFERENCIA, cotacao.usd_por_eth)
          : null,
    });
  } catch (erro) {
    console.error("[gas/estatisticas]", erro);
    res.status(500).json({ erro: String(erro) });
  }
});

/** GET /cotacao -- ETH/USD com a fonte e o instante. */
app.get("/cotacao", async (_req, res) => {
  const cotacao = await cotacaoEthUsd();
  if (!cotacao) {
    return res.status(503).json({
      erro: "cotação ETH/USD indisponível",
      como_resolver: "a Alchemy e o CoinGecko não responderam; o painel segue em gwei",
    });
  }
  res.json(cotacao);
});

/** GET /gas/calendario?dias=7 -- agregado horário para o heatmap. */
app.get("/gas/calendario", async (req, res) => {
  try {
    const dias = inteiroNaFaixa(req.query.dias, 7, 1, MAX_DIAS);
    const serie = await serieHorariaBruta(dias);
    res.json({ dias, pontos: serie.length, serie });
  } catch (erro) {
    console.error("[gas/calendario]", erro);
    res.status(500).json({ erro: String(erro) });
  }
});

/**
 * GET /stream -- Server-Sent Events, um evento por bloco novo.
 *
 * SSE e não WebSocket: o tráfego é unidirecional (servidor manda, painel
 * escuta), e o EventSource do navegador já reconecta sozinho quando a conexão
 * cai. WebSocket seria bidirecional sem ninguém usando a volta.
 *
 * Só emite com a ingestão ligada (INGESTAO_ATIVA=true) -- sem ela não há bloco
 * novo chegando, e a conexão fica aberta em silêncio. O primeiro comentário
 * enviado avisa disso, para o painel não parecer travado.
 */
app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Desliga buffering de proxy reverso: sem isto o nginx segura os eventos
    // até encher um buffer, e o "tempo real" chega em rajadas.
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  res.write(`: conectado (ingestao ${config.ingestaoAtiva ? "ativa" : "DESLIGADA"})\n\n`);

  const cancelar = assinar((evento) => {
    res.write(`data: ${JSON.stringify(evento)}\n\n`);
  });

  // Comentário periódico para a conexão não ser considerada ociosa e derrubada
  // por proxy ou firewall. Linha iniciada por ':' é ignorada pelo EventSource.
  const batimento = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(batimento);
    cancelar();
  });
});

/**
 * POST /otimizar -- plano de execução para N transações até um prazo.
 *
 * Junta as duas metades que hoje viviam separadas: lê a série horária do banco
 * e chama o solver com ela. O cliente não precisa saber que existe um serviço
 * Python atrás.
 *
 * Corpo:
 *   n_transacoes        int >= 1
 *   horas_ate_deadline  number > 0 (truncado para baixo em janelas de 1h)
 *   gas_used            int >= 1  -- OU `transacao`, para estimar via RPC
 *   transacao           { to, from?, data?, value? } -- opcional, alternativa
 *   horas_historico     int, opcional (padrão 672)
 */
app.post("/otimizar", async (req, res) => {
  try {
    const corpo = req.body ?? {};

    const nTransacoes = Number(corpo.n_transacoes);
    const horasAteDeadline = Number(corpo.horas_ate_deadline);
    const horasHistorico = Number(corpo.horas_historico ?? HORAS_HISTORICO_PADRAO);

    if (!Number.isInteger(nTransacoes) || nTransacoes < 1) {
      return res.status(422).json({ erro: "n_transacoes precisa ser inteiro >= 1" });
    }
    if (!Number.isFinite(horasAteDeadline) || horasAteDeadline <= 0) {
      return res.status(422).json({ erro: "horas_ate_deadline precisa ser > 0" });
    }
    if (!Number.isInteger(horasHistorico) || horasHistorico < MINIMO_HORAS_HISTORICO) {
      return res.status(422).json({
        erro: `horas_historico precisa ser inteiro >= ${MINIMO_HORAS_HISTORICO}`,
      });
    }

    const gasUsed = await resolverGasUsed(corpo);
    if (gasUsed instanceof Error) {
      return res.status(422).json({ erro: gasUsed.message });
    }

    const historico = await serieHoraria(horasHistorico);

    // Esta é a checagem que mais vai disparar enquanto não houver chave de RPC:
    // o endpoint público só entrega ~3,4h de histórico retroativo.
    if (historico.length < MINIMO_HORAS_HISTORICO) {
      return res.status(503).json({
        erro: `histórico insuficiente: ${historico.length}h no banco, mínimo ${MINIMO_HORAS_HISTORICO}h`,
        como_resolver:
          "rode o backfill com uma chave Alchemy/Infura em RPC_HTTP_URL, ou " +
          "deixe a ingestão ao vivo acumular (~24h por dia)",
      });
    }

    // Trava contra histórico defasado. Precisa vir DEPOIS da checagem de
    // tamanho: sem dado nenhum a mensagem certa é "histórico insuficiente",
    // não "histórico velho".
    const fimDaSerie = historico[historico.length - 1].momento;
    const defasagemHoras = (Date.now() - fimDaSerie.getTime()) / 3_600_000;
    if (defasagemHoras > MAX_DEFASAGEM_HORAS) {
      return res.status(503).json({
        erro: `histórico defasado: o último ponto é de ${fimDaSerie.toISOString()}, ` +
              `${defasagemHoras.toFixed(1)}h atrás (máximo ${MAX_DEFASAGEM_HORAS}h)`,
        por_que: "o plano seria calculado para uma janela que já passou, porque o " +
                 "solver prevê a partir da hora seguinte ao fim do histórico",
        como_resolver:
          "com dado sintético, rode ./scripts/semear.sh para regerar a série até agora; " +
          "com dado real, verifique se a ingestão está ligada (INGESTAO_ATIVA=true) e " +
          "se o backend alcança o nó RPC",
        serie_ate: fimDaSerie,
        defasagem_horas: Number(defasagemHoras.toFixed(2)),
      });
    }

    const resultado = await otimizar({
      historico,
      nTransacoes,
      horasAteDeadline,
      gasUsed,
    });

    // A economia em dólar é o número que interessa a quem decide. Aqui a
    // conversão é direta e não precisa de gas de referência: custo_total_gwei
    // já é um TOTAL (x_i x gas_used x custo_i somado), não um preço unitário.
    const cotacao = await cotacaoEthUsd();
    const emUsd = (gwei: number) => (cotacao ? gweiParaUsd(gwei, cotacao.usd_por_eth) : null);

    res.json({
      ...resultado,
      historico_horas: historico.length,
      historico_de: historico[0].momento,
      historico_ate: historico[historico.length - 1].momento,
      usd_por_eth: cotacao?.usd_por_eth ?? null,
      custo_total_usd: emUsd(resultado.custo_total_gwei),
      custo_baseline_t0_usd: emUsd(resultado.custo_baseline_t0_gwei),
      economia_usd: emUsd(resultado.custo_baseline_t0_gwei - resultado.custo_total_gwei),
      // Quanto o plano distribuído teria custado. Só é interessante quando a
      // trava de dominância descartou esse plano, mas sai sempre: um campo que
      // aparece e some conforme o caso é pior de consumir que um constante.
      custo_distribuido_usd: emUsd(resultado.custo_distribuido_gwei),
    });
  } catch (erro) {
    if (erro instanceof SolverRecusouError) {
      return res.status(422).json({ erro: String(erro.message) });
    }
    if (erro instanceof SolverIndisponivelError) {
      return res.status(503).json({ erro: String(erro.message) });
    }
    console.error("[otimizar] falha inesperada:", erro);
    res.status(500).json({ erro: String(erro) });
  }
});

/**
 * GAS_USED vem de `eth_estimateGas` (uma vez por pedido, não varia por janela).
 * Aceitamos o número pronto, para o cliente que já o tem, ou a transação para
 * estimar aqui. Devolve Error em vez de lançar para o handler decidir o status.
 */
async function resolverGasUsed(corpo: Record<string, unknown>): Promise<number | Error> {
  if (corpo.gas_used !== undefined) {
    const g = Number(corpo.gas_used);
    if (!Number.isInteger(g) || g < 1) return new Error("gas_used precisa ser inteiro >= 1");
    return g;
  }

  const t = corpo.transacao as Record<string, string> | undefined;
  if (!t?.to) {
    return new Error("informe gas_used, ou transacao.to para estimar via eth_estimateGas");
  }

  try {
    const estimado = await clienteHttp.estimateGas({
      to: t.to as `0x${string}`,
      ...(t.from ? { account: t.from as `0x${string}` } : {}),
      ...(t.data ? { data: t.data as `0x${string}` } : {}),
      ...(t.value ? { value: BigInt(t.value) } : {}),
    });
    return Number(estimado);
  } catch (erro) {
    // Só a primeira linha: o erro do viem traz stack, argumentos e a versão da
    // biblioteca, que não são informação para quem chamou a API.
    const primeiraLinha = String(erro).split("\n")[0];
    return new Error(`eth_estimateGas falhou: ${primeiraLinha}`);
  }
}

app.listen(config.porta, () => {
  console.log(`backend-node ouvindo na porta ${config.porta}`);
  if (config.ingestaoAtiva) iniciarIngestaoAoVivo();
  else console.log("[ingestao] desligada (INGESTAO_ATIVA=false)");
});
