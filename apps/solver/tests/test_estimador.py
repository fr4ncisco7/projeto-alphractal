"""Testes do estimador de custo_i -- estimador_custo.py.

O teste mais importante deste arquivo e' o de regressao da decisao 17. A ordem
das etapas ja' esteve invertida em producao e custava ~51% de perda em
horizontes >= 48h sem levantar erro nenhum -- o modulo rodava, so' entregava
numero errado. E' o tipo de falha que so' um teste pega.
"""

import numpy as np
import pandas as pd
import pytest
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from estimador_custo import HORAS_POR_DIA, prever, treinar
from sintetico import razao_realizada, serie_sintetica


def _razao_recuperada(fator_dia: np.ndarray) -> float:
    """Razao fim-de-semana/util implicita nos 7 fatores."""
    return float(fator_dia[5:].mean() / fator_dia[:5].mean())


# --- recuperacao do fator de dia da semana ---

@pytest.mark.parametrize("seed", [0, 1, 2, 3])
def test_recupera_fator_de_fim_de_semana(seed):
    """Compara com a razao REALIZADA no dado, nao com o parametro nominal:
    a reversao a media e o ruido deslocam uma da outra, e o estimador so' pode
    recuperar o que de fato esta' na serie."""
    serie = serie_sintetica(seed=seed)
    recuperada = _razao_recuperada(treinar(serie).fator_dia)
    assert recuperada == pytest.approx(razao_realizada(serie), rel=0.03)


def test_ordem_das_etapas_regressao_decisao_17():
    """Trava a ordem: fator de dia PRIMEIRO, direto do dado bruto.

    A versao antiga ajustava o Holt-Winters primeiro e tirava o fator de dia do
    RESIDUO. O nivel do HW e' uma media movel que persegue a observacao, entao
    absorvia a queda de fim de semana antes dela chegar ao residuo, que voltava
    a ~1,0 em todo dia. Este teste reimplementa aquela ordem e exige que a atual
    seja claramente melhor -- se alguem reinverter as etapas, quebra aqui.
    """
    serie = serie_sintetica(seed=0)
    alvo = razao_realizada(serie)

    # Ordem ATUAL (correta).
    atual = _razao_recuperada(treinar(serie).fator_dia)

    # Ordem ANTIGA (quebrada), reimplementada para comparacao.
    hw = ExponentialSmoothing(
        serie, trend=None, seasonal="mul", seasonal_periods=HORAS_POR_DIA,
        initialization_method="estimated",
    ).fit()
    residuo = serie / hw.fittedvalues
    dia = np.asarray(serie.index.dayofweek)
    antigo = np.array([np.median(residuo[dia == d]) for d in range(7)])
    antigo = antigo / antigo.mean()
    antiga = _razao_recuperada(antigo)

    erro_atual = abs(atual - alvo) / alvo
    erro_antigo = abs(antiga - alvo) / alvo

    assert erro_atual < 0.05, f"ordem atual deveria recuperar {alvo:.3f}, deu {atual:.3f}"
    assert antiga > 0.85, "a ordem antiga deveria colapsar o fator para perto de 1,0"
    assert erro_antigo > 10 * erro_atual, (
        f"a ordem atual (erro {erro_atual:.4f}) precisa ser muito melhor que a "
        f"antiga (erro {erro_antigo:.4f}); se elas empataram, a etapa 1 nao esta' "
        f"mais saindo do dado bruto")


def test_fator_dia_tem_media_um():
    """O fator carrega so' a forma relativa entre os dias -- o nivel absoluto
    e' responsabilidade do Holt-Winters. Se a media fugir de 1, o nivel entra
    contado duas vezes."""
    fator = treinar(serie_sintetica(seed=5)).fator_dia
    assert fator.mean() == pytest.approx(1.0)
    assert len(fator) == 7


def test_historico_curto_devolve_fator_neutro():
    """Menos de 7 dias completos nao da' para estimar 7 fatores."""
    serie = serie_sintetica(semanas=1, seed=0).iloc[:120]   # 5 dias
    assert np.allclose(treinar(serie).fator_dia, 1.0)


def test_pico_isolado_nao_redefine_o_dia():
    """Mediana entre as semanas, nao media: gas tem cauda pesada e um pico de
    15x num sabado nao pode virar o fator de sabado."""
    serie = serie_sintetica(seed=0)
    limpo = _razao_recuperada(treinar(serie).fator_dia)

    contaminado = serie.copy()
    sabado = contaminado.index.dayofweek == 5
    primeiro_sabado = np.flatnonzero(np.asarray(sabado))[:24]
    contaminado.iloc[primeiro_sabado] *= 15.0

    assert _razao_recuperada(treinar(contaminado).fator_dia) == pytest.approx(limpo, rel=0.10)


# --- previsao ---

def test_prever_devolve_vetor_finito_e_positivo():
    modelo = treinar(serie_sintetica(seed=0))
    custo_i = prever(modelo, horas_no_horizonte=48)
    assert custo_i.shape == (48,)
    assert np.all(np.isfinite(custo_i))
    assert np.all(custo_i > 0)


def test_previsao_segue_o_calendario():
    """A janela que cai no fim de semana precisa sair mais barata que a mesma
    hora num dia util -- e' o fator de dia entrando na previsao."""
    serie = serie_sintetica(seed=0)          # termina num domingo 23h
    modelo = treinar(serie)
    custo_i = prever(modelo, horas_no_horizonte=168)

    inicio = modelo.ultimo_timestamp + pd.Timedelta(hours=1)
    idx = pd.date_range(inicio, periods=168, freq="h")
    dia, hora = np.asarray(idx.dayofweek), np.asarray(idx.hour)

    mesma_hora = hora == 14
    util = custo_i[mesma_hora & (dia < 5)].mean()
    fim_de_semana = custo_i[mesma_hora & (dia >= 5)].mean()
    assert fim_de_semana < util


@pytest.mark.parametrize("horizonte", [24, 48, 72, 120])
def test_bate_media_simples_em_holdout(horizonte):
    """Decisao 8: o estimador precisa ganhar da media historica simples. O
    horizonte de 48h+ e' onde a ordem invertida falhava."""
    serie = serie_sintetica(semanas=10, seed=7)
    treino = serie.iloc[:-horizonte]
    teste = serie.iloc[-horizonte:].values

    previsto = prever(treinar(treino), horizonte)
    mape = float(np.mean(np.abs(previsto - teste) / teste))
    mape_media = float(np.mean(np.abs(treino.mean() - teste) / teste))

    assert mape < 0.15
    assert mape < mape_media / 3, (
        f"mape={mape:.4f} contra media simples={mape_media:.4f}: o estimador "
        f"deveria ganhar com folga")


def test_treinar_recusa_indice_nao_temporal():
    with pytest.raises(ValueError, match="DatetimeIndex"):
        treinar(pd.Series([1.0, 2.0, 3.0]))
