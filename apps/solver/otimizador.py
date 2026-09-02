"""
Otimizador de execucao -- MILP.

Formulacao fechada e testada (ver docs/registro-decisoes-tecnicas.md):

    variavel:    x_i = numero INTEIRO de transacoes na janela i  (decisao 3)
    objetivo:    minimizar  sum_i  x_i * GAS_USED * custo_i
    restricoes:  sum_i x_i = N
                 0 <= x_i <= teto,  teto = max(ceil(0.1*N), ceil(N/M))  (decisoes 6 e 34)
    solver:      scipy.optimize.milp, backend HiGHS               (decisao 9)

Deliberadamente AUSENTE: minimo por janela / inicio forcado. Foi testado via
Monte Carlo e piorou mediana (+0,45%) e pior caso (+28,0%) -- decisao 7. Nao
reintroduzir sem dado novo.

Sobre a formulacao ha' uma TRAVA DE DOMINANCIA (decisao 31): se o plano
distribuido custar mais que executar tudo agora, o resultado devolvido e' o
baseline. Nao e' parte do MILP -- e' uma comparacao final entre duas solucoes
viaveis, que impede o servico de recomendar algo pior que nao usa-lo.

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
    economia_pct: float             # nunca negativa: ver trava de dominancia
    executar_agora: bool            # True quando a trava trocou o plano pelo baseline
    custo_distribuido_gwei: float   # o que o plano do MILP custaria; util quando
                                    # executar_agora, para dizer o quanto seria pior


# Fracao de N que uma unica janela pode receber.
#
# Era 0,3, calibrada por Monte Carlo sobre dado SINTETICO (decisao 6). Dado
# sintetico nao tem a cauda pesada do gas real, e e' a cauda que quebra a
# concentracao: o backtest sobre 120h de mainnet (decisao 34) mediu, na economia
# AGREGADA com N=50, -32,9% em 24h e -6,3% em 12h com 0,3 -- ou seja, usar o
# otimizador saia' mais caro que nao usa-lo. Com 0,1: -0,7% e +6,7%.
FRACAO_MAXIMA_POR_JANELA = 0.1


def calcular_teto(n_transacoes: int, n_janelas: int) -> int:
    """
    teto = max( ceil(0,1 * N) , ceil(N / M) )

    O primeiro termo e' a protecao de risco: sem teto o MILP concentra tudo na
    janela mais barata PREVISTA, e quando a previsao erra num pico -- gas tem
    cauda pesada, 19x a mediana no corpus medido -- a perda e' enorme.

    O segundo termo existe so' para garantir VIABILIDADE em horizonte curto: com
    M=2 e N=20, um teto de 10% daria capacidade 4 < 20 e o solver retornaria
    infeasible. Ele relaxa o teto apenas o minimo necessario.
    """
    return max(
        math.ceil(FRACAO_MAXIMA_POR_JANELA * n_transacoes),
        math.ceil(n_transacoes / n_janelas),
    )


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

    custo_distribuido = float(c @ x)
    custo_baseline = float(n_transacoes * gas_used * custo_i[0])

    # ------------------------------------------------------------------
    # Trava de dominancia (decisao 31)
    # ------------------------------------------------------------------
    # O MILP nao tem a opcao de "nao fazer nada": sum(x_i) = N com x_i <= teto
    # o PROIBE de concentrar as N transacoes numa janela so' sempre que
    # teto < N. Quando a janela 0 e' a mais barata do horizonte -- comum em
    # prazo curto -- ele e' obrigado a espalhar para janelas piores, e o plano
    # sai mais caro que simplesmente executar tudo agora.
    #
    # Medido na mainnet em 02/09/2026 com N=50: prazos de 2h a 20h davam
    # economia entre -178% e -32%. Um servico que recomenda o pior dos dois
    # caminhos disponiveis nao pode ir para producao assim.
    #
    # A comparacao e' entre duas solucoes VIAVEIS do mesmo problema (o plano do
    # MILP e o vetor "tudo em t=0"), entao devolver a melhor nao afrouxa
    # restricao nenhuma. O teto continua valendo para o plano distribuido; o
    # baseline nao o viola porque nao e' uma escolha do otimizador, e' o que o
    # usuario faria sem ele -- e concentrar AGORA nao carrega risco de previsao,
    # que e' justamente o que o teto existe para conter (decisao 6).
    # Tolerancia relativa para o EMPATE nao virar dominancia. Com uma janela so'
    # -- ou quando o MILP escolhe exatamente o baseline -- os dois custos sao a
    # mesma conta em ordem de associacao diferente (`(g*c) @ x` contra
    # `n*g*c[0]`), e a diferenca de arredondamento decidia o sinalizador. Empate
    # nao e' o plano perdendo: e' o plano sendo o baseline.
    executar_agora = custo_distribuido > custo_baseline * (1 + 1e-9)
    if executar_agora:
        x = np.zeros(n_janelas, dtype=int)
        x[0] = n_transacoes
        custo_total = custo_baseline
    else:
        custo_total = custo_distribuido

    # max(0, ...) nao esconde economia negativa de verdade: depois da trava ela
    # nao existe mais. O que sobra e' o -0,000000001% do empate, que chegava na
    # tela como "-0,00%" -- um sinal de menos sem significado nenhum.
    economia = max(0.0, 100.0 * (1 - custo_total / custo_baseline)) if custo_baseline > 0 else 0.0

    return ResultadoOtimizacao(
        x=x,
        custo_total_gwei=custo_total,
        teto=teto,
        custo_baseline_t0_gwei=custo_baseline,
        economia_pct=economia,
        executar_agora=executar_agora,
        custo_distribuido_gwei=custo_distribuido,
    )
