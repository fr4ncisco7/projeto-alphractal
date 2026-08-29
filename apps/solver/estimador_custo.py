"""
Estimador de custo_i -- decomposicao hora-do-dia + dia-da-semana.

Formula: custo_i = nivel_e_sazonalidade_hora(hora de i) x fator_dia_da_semana(dia de i)

Testado e validado (ver /registro-decisoes-tecnicas.md, decisao 8) contra:
  - media historica simples (perdeu em todos os cenarios testados)
  - modelo unico de 168 posicoes hora x dia (falhou: poucos dados por slot)

Este modulo assume que o pipeline de ingestao ja existe e entrega uma
pandas.Series de custo de gas efetivo (base_fee + priority_fee, em gwei),
indexada por timestamp horario, sem buracos. Enquanto isso nao existe de
verdade, o bloco no final deste arquivo gera dado sintetico so pra validar
que o modulo roda -- troque `historico_real` por dado de verdade assim que
o pipeline estiver pronto, e o resto do codigo nao muda.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing


@dataclass
class ModeloEstimador:
    """Guarda o que foi aprendido do historico -- reutilizavel para prever
    quantas janelas futuras forem necessarias, sem re-treinar a cada chamada."""
    modelo_hora: object          # o ExponentialSmoothing ajustado (periodo=24h)
    fator_dia: np.ndarray        # 7 valores, um por dia da semana (0=segunda)
    ultimo_timestamp: pd.Timestamp


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

    # Etapa 1: sazonalidade de hora do dia (periodo=24)
    modelo_hora = ExponentialSmoothing(
        historico, trend=None, seasonal="mul", seasonal_periods=24,
        initialization_method="estimated",
    ).fit()

    # Etapa 2: fator de dia da semana, a partir do residuo do modelo de hora
    previsto_no_historico = modelo_hora.fittedvalues
    residuo = historico / previsto_no_historico
    dia_da_semana_hist = historico.index.dayofweek  # 0=segunda ... 6=domingo

    fator_dia = np.array([
        residuo[dia_da_semana_hist == d].mean() if (dia_da_semana_hist == d).any() else 1.0
        for d in range(7)
    ])

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
    dias_futuros = timestamps_futuros.dayofweek

    custo_i = previsao_hora * modelo.fator_dia[dias_futuros]
    return custo_i


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
    custo_i = prever(modelo, horas_no_horizonte=24)
    print("custo_i previsto para as proximas 24h (gwei):")
    print(np.round(custo_i, 4))
