"""
Otimizador de execucao -- MILP.

Formulacao fechada e testada (ver docs/registro-decisoes-tecnicas.md):

    variavel:    x_i = numero INTEIRO de transacoes na janela i  (decisao 3)
    objetivo:    minimizar  sum_i  x_i * GAS_USED * custo_i
    restricoes:  sum_i x_i = N
                 0 <= x_i <= teto,  teto = max(ceil(0.3*N), ceil(N/M))  (decisao 6)
    solver:      scipy.optimize.milp, backend HiGHS               (decisao 9)

Deliberadamente AUSENTE: minimo por janela / inicio forcado. Foi testado via
Monte Carlo e piorou mediana (+0,45%) e pior caso (+28,0%) -- decisao 7. Nao
reintroduzir sem dado novo.

Custos ficam em gwei o tempo todo; conversao para USD e' responsabilidade da
camada de exibicao (decisao 4).
"""

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


@dataclass
class ResultadoOtimizacao:
    """x[i] = quantas transacoes executar na janela i."""
    x: np.ndarray
    custo_total_gwei: float
    teto: int
    custo_baseline_t0_gwei: float   # decisao 10: baseline "tudo de uma vez em t=0"
    economia_pct: float


def calcular_teto(n_transacoes: int, n_janelas: int) -> int:
    """
    teto = max( ceil(0,3 * N) , ceil(N / M) )

    O primeiro termo e' a protecao de risco calibrada por Monte Carlo (decisao 6):
    sem teto o MILP concentra tudo na janela mais barata prevista, o que dobra o
    pior caso quando a previsao erra.

    O segundo termo existe so' para garantir VIABILIDADE em horizonte curto: com
    M=2 e N=20, um teto de 30% daria capacidade 12 < 20 e o solver retornaria
    infeasible. Ele relaxa o teto apenas o minimo necessario.
    """
    return max(math.ceil(0.3 * n_transacoes), math.ceil(n_transacoes / n_janelas))


def otimizar(custo_i, n_transacoes: int, gas_used: int,
             teto: int | None = None) -> ResultadoOtimizacao:
    """
    custo_i:       custo de gas por unidade de gas, em gwei, uma entrada por
                   janela de 1h do horizonte (M = len(custo_i))
    n_transacoes:  N -- transacoes restantes a executar (decisao 5, one-shot)
    gas_used:      GAS_USED de eth_estimateGas; unico para todas as N
                   transacoes (simplificacao consciente -- decisao 13)
    teto:          sobrescreve o teto da decisao 6. Existe para calibracao
                   (backtest/Monte Carlo comparando tetos); em producao deixar
                   None para usar a formula validada.
    """
    custo_i = np.asarray(custo_i, dtype=float)

    if custo_i.ndim != 1 or custo_i.size == 0:
        raise ValueError("custo_i precisa ser um vetor nao vazio (uma entrada por janela)")
    if not np.all(np.isfinite(custo_i)) or np.any(custo_i < 0):
        raise ValueError("custo_i tem valor nao finito ou negativo")
    if n_transacoes <= 0:
        raise ValueError("n_transacoes precisa ser >= 1")
    if gas_used <= 0:
        raise ValueError("gas_used precisa ser >= 1")

    n_janelas = custo_i.size
    if teto is None:
        teto = calcular_teto(n_transacoes, n_janelas)
    elif teto * n_janelas < n_transacoes:
        raise ValueError(
            f"teto={teto} com {n_janelas} janelas da' capacidade {teto*n_janelas} "
            f"< N={n_transacoes}: inviavel")

    # Coeficientes da funcao objetivo: custo de UMA transacao em cada janela.
    c = gas_used * custo_i

    resultado = milp(
        c=c,
        constraints=LinearConstraint(np.ones((1, n_janelas)), lb=n_transacoes, ub=n_transacoes),
        bounds=Bounds(lb=np.zeros(n_janelas), ub=np.full(n_janelas, teto)),
        integrality=np.ones(n_janelas),
    )

    if not resultado.success:
        raise RuntimeError(f"MILP nao resolveu: {resultado.message}")

    # HiGHS devolve float mesmo com integrality=1; arredondar e' seguro aqui.
    x = np.round(resultado.x).astype(int)

    custo_total = float(c @ x)
    custo_baseline = float(n_transacoes * gas_used * custo_i[0])
    economia = 100.0 * (1 - custo_total / custo_baseline) if custo_baseline > 0 else 0.0

    return ResultadoOtimizacao(
        x=x,
        custo_total_gwei=custo_total,
        teto=teto,
        custo_baseline_t0_gwei=custo_baseline,
        economia_pct=economia,
    )
