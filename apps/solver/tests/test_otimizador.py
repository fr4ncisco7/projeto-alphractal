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
    r = otimizar(custo_i, 10, GAS_USED)          # teto = max(3, 3) = 3
    assert r.x[1] == r.teto, "a janela mais barata deve estar no teto"
    assert r.x[0] < r.x[2], "a mais cara deve receber menos que a intermediaria"


def test_teto_nunca_e_furado():
    """Decisao 6: o teto e' a protecao de risco. Nenhuma janela pode passar."""
    custo_i = [0.99] * 9 + [0.01]                # uma janela absurdamente barata
    r = otimizar(custo_i, 30, GAS_USED)
    assert r.x[9] == r.teto
    assert r.x[9] < 30, "sem teto o MILP concentraria as 30 aqui"


# --- formula do teto (decisao 6) ---

@pytest.mark.parametrize("n, m, esperado", [
    (10, 24, 3),      # ceil(0,3*10)=3 domina
    (100, 24, 30),    # ceil(0,3*100)=30 domina
    (20, 2, 10),      # ceil(20/2)=10 domina -- o termo de viabilidade
    (1, 24, 1),       # N=1 nunca pode dar teto 0
    (7, 3, 3),        # ceil(2,1)=3 e ceil(7/3)=3
])
def test_formula_do_teto(n, m, esperado):
    assert calcular_teto(n, m) == esperado


def test_horizonte_curto_continua_viavel():
    """M=2, N=20: um teto de 30% daria capacidade 12 < 20 e o solver
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


def test_economia_negativa_quando_t0_e_o_melhor_momento():
    """Se t=0 ja' e' o mais barato, o teto forca parte para janelas piores e a
    economia fica negativa. E' o comportamento correto, nao um bug."""
    r = otimizar([0.10, 0.50, 0.60, 0.70], 10, GAS_USED)
    assert r.economia_pct < 0


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
