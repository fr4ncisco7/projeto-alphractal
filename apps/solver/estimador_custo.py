"""
Estimador de custo_i -- decomposicao hora-do-dia + dia-da-semana.

Formula: custo_i = nivel_e_sazonalidade_hora(hora de i) x fator_dia_da_semana(dia de i)

Testado e validado (ver docs/registro-decisoes-tecnicas.md, decisao 8) contra:
  - media historica simples (perdeu em todos os cenarios testados)
  - modelo unico de 168 posicoes hora x dia (falhou: poucos dados por slot)

ORDEM DAS ETAPAS (revisao de 29/08/2026 -- ver decisao 17):
A versao anterior ajustava o Holt-Winters primeiro e tirava o fator de dia do
RESIDUO. Isso nao funcionava: o nivel do Holt-Winters e' uma media movel que
persegue a observacao (alpha ajustado por maxima verossimilhanca deu 0,22 a
1,00 nos testes), entao ele absorvia a queda de fim de semana conforme ela
acontecia e o residuo voltava a ~1,0 em todo dia da semana. Medido com dado
sintetico de fator conhecido 0,55: recuperava 0,90 a 0,98, ou seja, quase nada.

Agora a ordem e' invertida -- fator de dia primeiro, direto do dado:

  1. Fator de dia da semana, a partir das MEDIAS DIARIAS. Cada dia calendario
     contem as 24 horas, entao a media diaria ja' esta' livre da sazonalidade
     de hora do dia -- a razao entre a media de um dia e a media global isola
     o efeito do dia da semana sem contaminacao.
  2. A serie e' dividida por esse fator (fica "neutra" quanto a dia da semana).
  3. Holt-Winters sazonal (periodo=24h) ajustado na serie ja' ajustada, entao
     o nivel nao tem mais padrao semanal para perseguir.
  4. Na previsao, as duas estimativas voltam a ser multiplicadas.

Este modulo assume que o pipeline de ingestao entrega uma pandas.Series de
custo de gas efetivo (base_fee + priority_fee, em gwei), indexada por timestamp
horario, SEM BURACOS -- use serie_horaria() no banco, que ja aplica gapfill.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

HORAS_POR_DIA = 24


@dataclass
class ModeloEstimador:
    """Guarda o que foi aprendido do historico -- reutilizavel para prever
    quantas janelas futuras forem necessarias, sem re-treinar a cada chamada."""
    modelo_hora: object          # ExponentialSmoothing ajustado na serie ja' ajustada por dia
    fator_dia: np.ndarray        # 7 valores, um por dia da semana (0=segunda)
    ultimo_timestamp: pd.Timestamp


def _fator_dia_da_semana(historico: pd.Series) -> np.ndarray:
    """
    Fator multiplicativo por dia da semana (0=segunda ... 6=domingo),
    normalizado para media 1 -- o nivel absoluto fica todo por conta do
    Holt-Winters, este fator carrega so' a forma relativa entre os dias.

    Usa MEDIANA entre as semanas disponiveis, nao media: gas tem cauda pesada
    (decisao 6) e um unico pico de 15x num sabado nao pode redefinir o fator
    de sabado.
    """
    dia_completo = historico.resample("D").count() == HORAS_POR_DIA
    media_diaria = historico.resample("D").mean()[dia_completo]

    # Menos de uma semana cheia nao da' para estimar 7 fatores: devolve neutro
    # e deixa o Holt-Winters explicar tudo sozinho.
    if len(media_diaria) < 7:
        return np.ones(7)

    razao = media_diaria / media_diaria.mean()
    dia_da_semana = np.asarray(media_diaria.index.dayofweek)

    fator = np.array([
        np.median(razao[dia_da_semana == d]) if (dia_da_semana == d).any() else 1.0
        for d in range(7)
    ])
    return fator / fator.mean()


def treinar(historico: pd.Series) -> ModeloEstimador:
    """
    historico: pandas.Series de custo de gas efetivo (gwei), indexada por
               timestamp horario (pd.DatetimeIndex), sem buracos.
               Minimo recomendado: ~4 semanas (672 pontos); mais historico
               tende a ajudar, mas o ganho nao e' estritamente monotonico
               (ver testes de sensibilidade na decisao 8).
    """
    if not isinstance(historico.index, pd.DatetimeIndex):
        raise ValueError("historico precisa ter DatetimeIndex horario")

    # Etapa 1: fator de dia da semana, direto do dado bruto.
    fator_dia = _fator_dia_da_semana(historico)

    # Etapa 2: remove o efeito de dia da semana antes de ajustar o Holt-Winters,
    # para que o nivel nao tenha padrao semanal para perseguir.
    ajustado = historico / fator_dia[np.asarray(historico.index.dayofweek)]

    # Etapa 3: sazonalidade de hora do dia (periodo=24) na serie ja' ajustada.
    modelo_hora = ExponentialSmoothing(
        ajustado, trend=None, seasonal="mul", seasonal_periods=HORAS_POR_DIA,
        initialization_method="estimated",
    ).fit()

    return ModeloEstimador(
        modelo_hora=modelo_hora,
        fator_dia=fator_dia,
        ultimo_timestamp=historico.index[-1],
    )


def prever(modelo: ModeloEstimador, horas_no_horizonte: int) -> np.ndarray:
    """
    Devolve o array custo_i (tamanho = horas_no_horizonte), pronto pra
    entrar direto na funcao objetivo do MILP (multiplicado por GAS_USED).
    """
    previsao_hora = modelo.modelo_hora.forecast(horas_no_horizonte).values

    timestamps_futuros = pd.date_range(
        start=modelo.ultimo_timestamp + pd.Timedelta(hours=1),
        periods=horas_no_horizonte, freq="h",
    )
    dias_futuros = np.asarray(timestamps_futuros.dayofweek)

    return previsao_hora * modelo.fator_dia[dias_futuros]


# ------------------------------------------------------------------
# Bloco de validacao com dado SINTETICO -- so pra confirmar que o modulo
# roda de ponta a ponta. Apague/ignore isto quando plugar dado real.
# ------------------------------------------------------------------
if __name__ == "__main__":
    rng = np.random.RandomState(0)
    n_horas = 8 * 168
    idx = pd.date_range("2026-07-01", periods=n_horas, freq="h")
    hora, dia = idx.hour.values, idx.dayofweek.values
    fator_hora_real = 1.0 + 0.8 * np.exp(-0.5 * ((hora - 14) / 4) ** 2)
    fator_dia_real = np.where(dia >= 5, 0.55, 1.0)
    log_p = np.log(0.15)
    valores = []
    for h in range(n_horas):
        mu = np.log(0.15 * fator_hora_real[h] * fator_dia_real[h])
        log_p += 0.10 * (mu - log_p) + 0.20 * rng.randn()
        v = np.exp(log_p)
        if rng.rand() < 0.01:
            v *= rng.uniform(3, 15)
        valores.append(v)
    historico_real = pd.Series(valores, index=idx)  # <-- troque por dado real aqui

    modelo = treinar(historico_real)
    razao = modelo.fator_dia[5:].mean() / modelo.fator_dia[:5].mean()
    print(f"fator_dia (seg..dom): {np.round(modelo.fator_dia, 3)}")
    print(f"razao fim-de-semana/util recuperada: {razao:.3f}  (verdade injetada: 0.550)")

    custo_i = prever(modelo, horas_no_horizonte=24)
    print("\ncusto_i previsto para as proximas 24h (gwei):")
    print(np.round(custo_i, 4))
