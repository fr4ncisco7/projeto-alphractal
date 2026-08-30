"""Testes do endpoint -- main.py.

Cobre o contrato que o backend Node vai consumir: formato da resposta, o
truncamento do horizonte e cada caminho de 422. As validacoes de historico
existem porque o Holt-Winters sazonal quebra com buraco, e quebrar cedo com
mensagem clara e' melhor que devolver plano silenciosamente errado.
"""

import pytest
from fastapi.testclient import TestClient

from main import MINIMO_HORAS_HISTORICO, RECOMENDADO_HORAS_HISTORICO, app
from sintetico import serie_sintetica

cliente = TestClient(app)

GAS_USED = 21_000


def historico_payload(horas: int = 504, seed: int = 0) -> list[dict]:
    serie = serie_sintetica(semanas=6, seed=seed).iloc[:horas]
    return [{"momento": t.isoformat(), "gwei": float(v)} for t, v in serie.items()]


def pedido(**sobrescreve) -> dict:
    base = {
        "historico": historico_payload(),
        "n_transacoes": 10,
        "horas_ate_deadline": 24,
        "gas_used": GAS_USED,
    }
    base.update(sobrescreve)
    return base


def test_health():
    r = cliente.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_optimize_caminho_feliz():
    r = cliente.post("/optimize", json=pedido())
    assert r.status_code == 200
    corpo = r.json()

    assert corpo["n_janelas"] == 24
    assert len(corpo["plano"]) == 24
    assert sum(j["x"] for j in corpo["plano"]) == 10
    assert all(j["x"] <= corpo["teto_por_janela"] for j in corpo["plano"])
    assert [j["janela"] for j in corpo["plano"]] == list(range(24))
    assert corpo["custo_total_gwei"] > 0
    assert corpo["custo_baseline_t0_gwei"] > 0


def test_custo_da_janela_bate_com_as_partes():
    """custo_janela = x * gas_used * custo_i, e a soma das janelas e' o total."""
    corpo = cliente.post("/optimize", json=pedido()).json()
    for j in corpo["plano"]:
        assert j["custo_janela_gwei"] == pytest.approx(
            j["x"] * GAS_USED * j["custo_i_gwei"], rel=1e-9)
    soma = sum(j["custo_janela_gwei"] for j in corpo["plano"])
    assert soma == pytest.approx(corpo["custo_total_gwei"], rel=1e-9)


@pytest.mark.parametrize("horas, janelas_esperadas", [
    (24.0, 24),
    (5.5, 5),      # trunca para baixo
    (5.99, 5),
    (1.0, 1),
])
def test_horizonte_trunca_para_baixo(horas, janelas_esperadas):
    """Nunca recomendar execucao depois do prazo: 5,5h vira 5 janelas, nao 6."""
    corpo = cliente.post("/optimize", json=pedido(horas_ate_deadline=horas)).json()
    assert corpo["n_janelas"] == janelas_esperadas
    assert len(corpo["plano"]) == janelas_esperadas


def test_horizonte_que_trunca_para_zero_e_recusado():
    r = cliente.post("/optimize", json=pedido(horas_ate_deadline=0.5))
    assert r.status_code == 422
    assert "execute imediatamente" in r.json()["detail"]


# --- validacao do historico ---

def test_historico_curto_demais_e_recusado():
    r = cliente.post("/optimize", json=pedido(historico=historico_payload(horas=47)))
    assert r.status_code == 422
    assert str(MINIMO_HORAS_HISTORICO) in r.json()["detail"]


def test_historico_com_buraco_e_recusado():
    """O gapfill e' responsabilidade do serie_horaria() no banco. Se chegou
    buraco aqui, o Holt-Winters sazonal produziria NaN sem avisar."""
    h = historico_payload()
    del h[100:104]
    r = cliente.post("/optimize", json=pedido(historico=h))
    assert r.status_code == 422
    assert "4 hora(s) faltando" in r.json()["detail"]


def test_historico_com_timestamp_duplicado_e_recusado():
    h = historico_payload()
    h.append(dict(h[50]))
    r = cliente.post("/optimize", json=pedido(historico=h))
    assert r.status_code == 422
    assert "duplicados" in r.json()["detail"]


def test_historico_com_timestamp_invalido_e_recusado():
    h = historico_payload()
    h[10]["momento"] = "ontem de tarde"
    r = cliente.post("/optimize", json=pedido(historico=h))
    assert r.status_code == 422
    assert "ISO-8601" in r.json()["detail"]


def test_historico_fora_de_ordem_e_aceito():
    """Ordem do payload nao deveria importar -- o servico ordena antes de usar."""
    h = historico_payload()
    embaralhado = h[::-1]
    r = cliente.post("/optimize", json=pedido(historico=embaralhado))
    assert r.status_code == 200
    assert r.json()["n_janelas"] == 24


# --- aviso de historico curto (decisao 8) ---

def test_aviso_quando_historico_abaixo_do_recomendado():
    corpo = cliente.post("/optimize", json=pedido(historico=historico_payload(504))).json()
    assert corpo["aviso"] is not None
    assert "fator de dia da semana" in corpo["aviso"]


def test_sem_aviso_com_historico_suficiente():
    h = historico_payload(horas=RECOMENDADO_HORAS_HISTORICO)
    corpo = cliente.post("/optimize", json=pedido(historico=h)).json()
    assert corpo["aviso"] is None


# --- validacao do pydantic (422 antes de chegar na logica) ---

@pytest.mark.parametrize("sobrescreve", [
    {"n_transacoes": 0},
    {"n_transacoes": -5},
    {"gas_used": 0},
    {"horas_ate_deadline": 0},
    {"horas_ate_deadline": -3},
])
def test_parametros_fora_do_dominio_sao_recusados(sobrescreve):
    assert cliente.post("/optimize", json=pedido(**sobrescreve)).status_code == 422


def test_gwei_negativo_no_historico_e_recusado():
    h = historico_payload()
    h[5]["gwei"] = -1.0
    assert cliente.post("/optimize", json=pedido(historico=h)).status_code == 422
