import express from "express";
import { config } from "./config.js";
import { pool, serieHoraria } from "./db.js";
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

/** Mesmo mínimo que o solver exige: 2 ciclos sazonais de 24h. Checamos aqui
 *  também para dar a mensagem certa -- o solver não sabe do limite do RPC. */
const MINIMO_HORAS_HISTORICO = 48;

/** Quanto histórico pedir ao banco. 4 semanas é o recomendado pela decisão 8
 *  para o fator de dia da semana. Pedir mais que existe não é erro: a série
 *  volta menor e o solver avisa. */
const HORAS_HISTORICO_PADRAO = 672;

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
      ingestao: config.ingestaoAtiva ? "ativa" : "desligada",
      solver: solverOk ? "ok" : "inalcancavel",
    });
  } catch (erro) {
    res.status(503).json({ status: "degradado", erro: String(erro) });
  }
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

    const resultado = await otimizar({
      historico,
      nTransacoes,
      horasAteDeadline,
      gasUsed,
    });

    res.json({
      ...resultado,
      historico_horas: historico.length,
      historico_de: historico[0].momento,
      historico_ate: historico[historico.length - 1].momento,
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
