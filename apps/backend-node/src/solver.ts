import { config } from "./config.js";
import type { PontoHorario } from "./db.js";

/**
 * Cliente HTTP do serviço de solver.
 *
 * O solver é stateless e não fala com o banco (decisão 12): quem lê a série é
 * este backend, que a envia no corpo do pedido. Isso mantém as credenciais do
 * banco num serviço só e deixa o solver testável sem infraestrutura.
 *
 * Os tipos abaixo espelham os contratos Pydantic de `apps/solver/main.py`. Como
 * são dois serviços em linguagens diferentes, não há tipo compartilhado que o
 * compilador verifique -- a garantia vem dos testes do solver (`test_api.py`),
 * que travam o formato da resposta. Alterar um lado exige alterar o outro.
 *
 * Nota de nomenclatura: os campos aqui saem em snake_case porque são o
 * contrato de rede do solver, não código nosso.
 */

export interface JanelaPlano {
  janela: number;
  x: number;
  custo_i_gwei: number;
  custo_janela_gwei: number;
}

export interface RespostaOtimizacao {
  plano: JanelaPlano[];
  custo_total_gwei: number;
  custo_baseline_t0_gwei: number;
  economia_pct: number;
  teto_por_janela: number;
  n_janelas: number;
  aviso: string | null;
}

export interface PedidoOtimizacao {
  historico: PontoHorario[];
  nTransacoes: number;
  horasAteDeadline: number;
  gasUsed: bigint | number;
}

/** O solver recusou a entrada (422). Erro do pedido, não do serviço. */
export class SolverRecusouError extends Error {}

/** O solver não respondeu, ou respondeu 5xx. Erro de infraestrutura. */
export class SolverIndisponivelError extends Error {}

export async function otimizar(pedido: PedidoOtimizacao): Promise<RespostaOtimizacao> {
  const corpo = {
    historico: pedido.historico.map((p) => ({
      momento: p.momento.toISOString(),
      gwei: p.precoGwei,
    })),
    n_transacoes: pedido.nTransacoes,
    horas_ate_deadline: pedido.horasAteDeadline,
    gas_used: Number(pedido.gasUsed),
  };

  let resposta: Response;
  try {
    resposta = await fetch(`${config.solverUrl}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(config.solverTimeoutMs),
    });
  } catch (erro) {
    // Cobre tanto solver fora do ar quanto estouro do timeout.
    throw new SolverIndisponivelError(
      `não foi possível falar com o solver em ${config.solverUrl}: ${String(erro)}`,
    );
  }

  if (resposta.status === 422) {
    // O FastAPI usa `detail` tanto para string (nossos HTTPException) quanto
    // para a lista de erros do Pydantic; normalizamos para texto.
    const corpoErro = (await resposta.json().catch(() => null)) as { detail?: unknown } | null;
    const detalhe = corpoErro?.detail;
    throw new SolverRecusouError(
      typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe ?? "entrada inválida"),
    );
  }

  if (!resposta.ok) {
    throw new SolverIndisponivelError(
      `solver respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`,
    );
  }

  return (await resposta.json()) as RespostaOtimizacao;
}

/** Health check do solver, para compor o /health do backend. */
export async function solverSaudavel(): Promise<boolean> {
  try {
    const r = await fetch(`${config.solverUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
