"""Gerador de serie sintetica de gas, compartilhado pelos testes.

Reproduz as tres caracteristicas do gas real que importam para o estimador:
sazonalidade de hora do dia, desconto de fim de semana e cauda pesada.
"""

import numpy as np
import pandas as pd


def serie_sintetica(
    semanas: int = 8,
    fator_fim_de_semana: float = 0.55,
    forca_reversao: float = 0.6,
    ruido: float = 0.05,
    prob_pico: float = 0.0,
    inicio: str = "2026-07-06",   # uma segunda-feira
    seed: int = 0,
) -> pd.Series:
    """
    forca_reversao alto (0,6) faz o processo seguir de perto o sinal injetado,
    entao a razao REALIZADA fica proxima da nominal. O default do modulo de
    validacao usa 0,10, que suaviza tanto que a razao realizada sobe para ~0,61
    -- util para realismo, ruim para um teste que precisa de alvo estavel.
    """
    rng = np.random.RandomState(seed)
    n_horas = semanas * 168
    idx = pd.date_range(inicio, periods=n_horas, freq="h")
    hora = np.asarray(idx.hour)
    dia = np.asarray(idx.dayofweek)

    fator_hora = 1.0 + 0.8 * np.exp(-0.5 * ((hora - 14) / 4) ** 2)
    fator_dia = np.where(dia >= 5, fator_fim_de_semana, 1.0)

    log_p = np.log(0.15)
    valores = np.empty(n_horas)
    for h in range(n_horas):
        mu = np.log(0.15 * fator_hora[h] * fator_dia[h])
        log_p += forca_reversao * (mu - log_p) + ruido * rng.randn()
        v = np.exp(log_p)
        if prob_pico and rng.rand() < prob_pico:
            v *= rng.uniform(3, 15)
        valores[h] = v

    return pd.Series(valores, index=idx)


def razao_realizada(serie: pd.Series) -> float:
    """Razao fim-de-semana/util efetivamente presente no dado gerado.

    E' este o alvo que o estimador pode recuperar -- nao o parametro nominal,
    que a reversao a media e o ruido deslocam.
    """
    dia = np.asarray(serie.index.dayofweek)
    return float(serie[dia >= 5].mean() / serie[dia < 5].mean())
