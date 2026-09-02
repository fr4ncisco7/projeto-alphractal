"""Testes do MILP -- otimizador.py.

O teste central compara o MILP contra forca bruta em instancias pequenas: se o
HiGHS devolvesse um otimo local ou violasse integralidade, a comparacao pegaria.
"""

import itertools

import numpy as np
import pytest

from otimizador import calcular_teto, otimizar

GAS_USED = 21_000


def _forca_bruta(custo_i, n_transacoes, gas_used, teto):
    """Otimo exato por enumeracao. So' viavel para M e N pequenos."""
    m = len(custo_i)
    melhor = None
    for x in itertools.product(range(teto + 1), repeat=m):
        if sum(x) != n_transacoes:
            continue
        custo = gas_used * sum(xi * ci for xi, ci in zip(x, custo_i))
        if melhor is None or custo < melhor:
            melhor = custo
    return melhor


@pytest.mark.parametrize("custo_i, n", [
    ([0.30, 0.10, 0.25, 0.40], 10),
    ([0.15, 0.15, 0.15, 0.15], 7),      # empate total
    ([0.90, 0.10], 5),
    ([0.20, 0.50, 0.05, 0.05, 0.60], 12),
    ([1.00, 0.99, 0.98, 0.97], 9),      # diferencas minimas
])
def test_milp_bate_com_forca_bruta(custo_i, n):
    r = otimizar(custo_i, n, GAS_USED)
    esperado = _forca_bruta(custo_i, n, GAS_USED, r.teto)
    assert r.custo_total_gwei == pytest.approx(esperado, rel=1e-9)


def test_respeita_restricoes():
    custo_i = [0.30, 0.10, 0.25, 0.40, 0.12, 0.33]
    r = otimizar(custo_i, 20, GAS_USED)
    assert r.x.sum() == 20
    assert np.all(r.x >= 0)
    assert np.all(r.x <= r.teto)
    assert r.x.dtype.kind == "i", "x precisa ser inteiro -- e' um MILP, nao um LP"


def test_concentra_nas_janelas_mais_baratas():
    """Sem o teto o MILP poria tudo na mais barata; com teto, deve encher as
    mais baratas em ordem ate' o teto."""
    custo_i = [0.50, 0.10, 0.20, 0.30]
    r = otimizar(custo_i, 10, GAS_USED)          # teto = max(1, 3) = 3
    assert r.x[1] == r.teto, "a janela mais barata deve estar no teto"
    assert r.x[0] < r.x[2], "a mais cara deve receber menos que a intermediaria"


def test_teto_nunca_e_furado():
    """Decisao 6: o teto e' a protecao de risco. Nenhuma janela pode passar."""
    custo_i = [0.99] * 9 + [0.01]                # uma janela absurdamente barata
    r = otimizar(custo_i, 30, GAS_USED)
    assert r.x[9] == r.teto
    assert r.x[9] < 30, "sem teto o MILP concentraria as 30 aqui"


# --- formula do teto (decisoes 6 e 34) ---

@pytest.mark.parametrize("n, m, esperado", [
    (50, 24, 5),      # ceil(0,1*50)=5 domina -- o ponto calibrado na decisao 34
    (100, 24, 10),    # ceil(0,1*100)=10 domina
    (10, 24, 1),      # ceil(0,1*10)=1 domina
    (20, 2, 10),      # ceil(20/2)=10 domina -- o termo de viabilidade
    (1, 24, 1),       # N=1 nunca pode dar teto 0
    (7, 3, 3),        # ceil(0,7)=1 mas ceil(7/3)=3 domina
])
def test_formula_do_teto(n, m, esperado):
    assert calcular_teto(n, m) == esperado


@pytest.mark.parametrize("n, m", [(20, 2), (50, 24), (3, 1), (1, 1), (7, 3), (100, 5)])
def test_teto_sempre_da_capacidade(n, m):
    """A capacidade `teto * M` nunca pode ficar abaixo de N: seria infeasible.
    Com a fracao em 10% a folga e' menor que era com 30%, entao a garantia
    passou a valer a pena testar em varios pontos, nao so' num caso."""
    assert calcular_teto(n, m) * m >= n


def test_horizonte_curto_continua_viavel():
    """M=2, N=20: um teto de 10% daria capacidade 4 < 20 e o solver
    retornaria infeasible. O segundo termo do max existe para isto."""
    r = otimizar([0.30, 0.10], 20, GAS_USED)
    assert r.x.sum() == 20


def test_janela_unica():
    r = otimizar([0.42], 15, GAS_USED)
    assert r.x.tolist() == [15]
    assert r.economia_pct == pytest.approx(0.0)


# --- baseline e economia (decisao 10) ---

def test_baseline_e_tudo_em_t0():
    custo_i = [0.40, 0.10, 0.10, 0.10]
    r = otimizar(custo_i, 10, GAS_USED)
    assert r.custo_baseline_t0_gwei == pytest.approx(10 * GAS_USED * 0.40)
    assert r.custo_total_gwei < r.custo_baseline_t0_gwei
    assert r.economia_pct > 0


# --- trava de dominancia (decisao 31) ---

def test_quando_t0_e_o_melhor_a_trava_devolve_o_baseline():
    """Se t=0 ja' e' o mais barato, o teto forca parte das transacoes para
    janelas piores e o plano do MILP sai mais caro que executar tudo agora.
    A trava troca esse plano pelo baseline em vez de recomenda-lo."""
    r = otimizar([0.10, 0.50, 0.60, 0.70], 10, GAS_USED)

    assert r.executar_agora is True
    # Plano devolvido: tudo na janela 0, ignorando o teto -- concentrar AGORA
    # nao tem risco de previsao, que e' o que o teto contem (decisao 6).
    assert list(r.x) == [10, 0, 0, 0]
    assert r.custo_total_gwei == pytest.approx(r.custo_baseline_t0_gwei)
    assert r.economia_pct == pytest.approx(0.0)
    # O custo do plano descartado continua exposto, para a interface poder
    # dizer o quanto distribuir seria pior.
    assert r.custo_distribuido_gwei > r.custo_baseline_t0_gwei


def test_trava_nao_dispara_quando_distribuir_compensa():
    r = otimizar([0.40, 0.10, 0.10, 0.10], 10, GAS_USED)
    assert r.executar_agora is False
    assert r.custo_total_gwei == pytest.approx(r.custo_distribuido_gwei)
    assert r.economia_pct > 0


@pytest.mark.parametrize("custo_i", [
    [0.10, 0.50, 0.60, 0.70],        # t0 e' o unico barato
    [0.40, 0.10, 0.10, 0.10],        # distribuir compensa
    [0.25, 0.25, 0.25, 0.25],        # tudo igual
    [0.10, 0.11, 0.90, 0.95, 0.99],  # t0 barato, um vizinho quase igual
    [0.30, 0.29],                    # dois passos, diferenca minima
    [0.1150],                        # uma janela: plano E' o baseline (empate)
    [0.0],                           # janela 0 de graca: baseline custa zero
])
@pytest.mark.parametrize("n", [1, 7, 10, 50])
def test_economia_nunca_e_negativa(custo_i, n):
    """A garantia que a trava existe para dar: usar o otimizador nunca pode
    sair pior que nao usa-lo."""
    r = otimizar(custo_i, n, GAS_USED)
    # Estritamente >= 0, sem approx: era exatamente o -1e-14 do empate que
    # chegava na interface formatado como "-0,00%".
    assert r.economia_pct >= 0.0
    assert r.custo_total_gwei <= r.custo_baseline_t0_gwei + 1e-9


def test_com_uma_janela_o_plano_e_o_baseline():
    """Horizonte de uma hora: nao ha' o que distribuir, e a economia e' zero
    sem a trava precisar disparar."""
    r = otimizar([0.42], 10, GAS_USED)
    assert list(r.x) == [10]
    assert r.economia_pct == pytest.approx(0.0)
    assert r.executar_agora is False


# --- caminhos de erro ---

@pytest.mark.parametrize("kwargs, trecho", [
    (dict(custo_i=[], n_transacoes=5, gas_used=GAS_USED), "vetor nao vazio"),
    (dict(custo_i=[[0.1, 0.2]], n_transacoes=5, gas_used=GAS_USED), "vetor nao vazio"),
    (dict(custo_i=[0.1, np.nan], n_transacoes=5, gas_used=GAS_USED), "nao finito"),
    (dict(custo_i=[0.1, np.inf], n_transacoes=5, gas_used=GAS_USED), "nao finito"),
    (dict(custo_i=[0.1, -0.2], n_transacoes=5, gas_used=GAS_USED), "nao finito ou negativo"),
    (dict(custo_i=[0.1, 0.2], n_transacoes=0, gas_used=GAS_USED), "n_transacoes"),
    (dict(custo_i=[0.1, 0.2], n_transacoes=5, gas_used=0), "gas_used"),
])
def test_entrada_invalida_levanta_value_error(kwargs, trecho):
    with pytest.raises(ValueError, match=trecho):
        otimizar(**kwargs)


def test_teto_explicito_inviavel_e_recusado():
    """Teto manual existe para calibracao; se for pequeno demais, a mensagem
    precisa dizer isso em vez de deixar o HiGHS falhar com 'infeasible'."""
    with pytest.raises(ValueError, match="inviavel"):
        otimizar([0.1, 0.2, 0.3], n_transacoes=100, gas_used=GAS_USED, teto=5)


def test_teto_explicito_e_respeitado():
    r = otimizar([0.5, 0.1, 0.2, 0.3], n_transacoes=10, gas_used=GAS_USED, teto=4)
    assert r.teto == 4
    assert r.x.max() <= 4
    assert r.x.sum() == 10
