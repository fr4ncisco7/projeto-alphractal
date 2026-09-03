"""
Benchmark: com solver contra sem solver, sobre cenários reais de mainnet.

A pergunta que este arquivo responde é a da apresentação: **quanto muda usar o
otimizador, em dinheiro, em cenários que de fato aconteceram?**

Reaproveita o motor do `backtest.py` -- mesmo walk-forward, mesma regra de que o
plano nasce da previsão e é cobrado pelo preço REAL. A diferença é o recorte:
o backtest responde "a formulação funciona?", este responde "quanto o usuário
ganha ou perde?", e emite JSON para virar gráfico.

Quatro estratégias, todas cobradas pelo preço real:

    agora     tudo na primeira janela   -- o que se faz sem a ferramenta
    solver    MILP sobre a previsão     -- o produto
    uniforme  N/M por janela            -- espalhar sem pensar
    oraculo   MILP sobre o custo real   -- o teto do alcançável

Uso:  ./scripts/benchmark.sh              (imprime o resumo)
      ./scripts/benchmark.sh --json b.json
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

import numpy as np

from backtest import (
    CORPUS_PADRAO,
    GAS_USED,
    MINIMO_TREINO,
    Observacao,
    _plano_uniforme,
    avaliar_origem,
    carregar_corpus,
)

# Transações de referência, para converter gwei em dinheiro.
PERFIS_DE_GAS = {"transferencia": 21_000, "swap": 150_000}


def _pct(parte: float, total: float) -> float:
    return 100.0 * (1 - parte / total) if total > 0 else 0.0


def rodar_cenarios(serie, horizontes, enes, minimo_treino=MINIMO_TREINO):
    """
    Uma linha por (N, horizonte), com todas as origens agregadas.

    O modelo é treinado uma vez por origem e a previsão é fatiada por horizonte,
    como no backtest: o estimador não depende de N nem do prazo.
    """
    from estimador_custo import prever, treinar

    h_max = max(horizontes)
    cenarios: dict[tuple[int, int], list[Observacao]] = {
        (n, h): [] for n in enes for h in horizontes
    }

    for t in range(minimo_treino, len(serie) - h_max + 1):
        previsao = prever(treinar(serie.iloc[:t]), h_max)
        for h in horizontes:
            reais = serie.iloc[t:t + h].to_numpy()
            for n in enes:
                cenarios[(n, h)].append(
                    avaliar_origem(previsao[:h], reais, serie.index[t], n)
                )
    return cenarios


def resumir_cenario(obs: list[Observacao], n_transacoes: int) -> dict:
    """Números de um par (N, horizonte), em gwei e em percentual."""
    total_agora = sum(o.custo_agora for o in obs)
    total_solver = sum(o.custo_plano for o in obs)
    total_uniforme = sum(o.custo_uniforme for o in obs)
    total_oraculo = sum(o.custo_oraculo for o in obs)

    por_origem = [o.economia_plano_pct for o in obs]
    # "Não piorou" com tolerância de 1e-9: a trava de dominância devolve o
    # baseline exato, e comparação de float sem folga marcaria isso como perda.
    nao_piorou = sum(1 for o in obs if o.custo_plano <= o.custo_agora + 1e-9)
    melhorou = sum(1 for o in obs if o.custo_plano < o.custo_agora - 1e-9)

    ordenado = sorted(por_origem)
    return {
        "n_transacoes": n_transacoes,
        "origens": len(obs),
        "gwei": {
            "agora": total_agora,
            "solver": total_solver,
            "uniforme": total_uniforme,
            "oraculo": total_oraculo,
        },
        "economia_agregada_pct": _pct(total_solver, total_agora),
        "economia_uniforme_pct": _pct(total_uniforme, total_agora),
        "economia_oraculo_pct": _pct(total_oraculo, total_agora),
        "mediana_pct": statistics.median(por_origem),
        "p05_pct": float(np.percentile(ordenado, 5)),
        "p95_pct": float(np.percentile(ordenado, 95)),
        "nao_piorou": nao_piorou,
        "melhorou": melhorou,
        "por_origem_pct": por_origem,
    }


def horas_de_pico(serie, percentil: float = 99.0) -> tuple[list[int], float]:
    """Índices das horas acima do percentil dado. Gas tem cauda pesada: poucas
    horas concentram o risco inteiro, e vale saber quais são."""
    v = serie.to_numpy()
    limiar = float(np.percentile(v, percentil))
    return [i for i, x in enumerate(v) if x > limiar], limiar


def sensibilidade_ao_pico(serie, horizonte: int, n_transacoes: int,
                          minimo_treino=MINIMO_TREINO) -> dict:
    """
    O mesmo cenário, com e sem os horizontes que contêm hora de pico.

    Não é para escolher o número mais bonito: é para separar o que o otimizador
    faz em condição normal do que acontece quando um pico imprevisível cai numa
    janela escolhida. As duas metades contam histórias diferentes e as duas
    precisam ser ditas.
    """
    from estimador_custo import prever, treinar

    picos, limiar = horas_de_pico(serie)
    todas, sem_pico = [], []
    for t in range(minimo_treino, len(serie) - horizonte + 1):
        previsao = prever(treinar(serie.iloc[:t]), horizonte)
        reais = serie.iloc[t:t + horizonte].to_numpy()
        o = avaliar_origem(previsao, reais, serie.index[t], n_transacoes)
        todas.append(o)
        if not any(t <= i < t + horizonte for i in picos):
            sem_pico.append(o)

    return {
        "horizonte_h": horizonte,
        "n_transacoes": n_transacoes,
        "limiar_pico_gwei": limiar,
        "horas_de_pico": len(picos),
        "todas": resumir_cenario(todas, n_transacoes),
        "sem_pico": resumir_cenario(sem_pico, n_transacoes),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, default=CORPUS_PADRAO)
    p.add_argument("--horizontes", type=int, nargs="+", default=[6, 12, 24])
    p.add_argument("--enes", type=int, nargs="+", default=[10, 50, 200, 500])
    p.add_argument("--usd-por-eth", type=float, default=2400.0)
    p.add_argument("--json", type=Path, default=None)
    args = p.parse_args()

    serie = carregar_corpus(args.corpus)
    cenarios = rodar_cenarios(serie, args.horizontes, args.enes)

    saida = {
        "corpus": {
            "horas": len(serie),
            "de": str(serie.index[0]),
            "ate": str(serie.index[-1]),
            "gwei_min": float(serie.min()),
            "gwei_mediana": float(serie.median()),
            "gwei_max": float(serie.max()),
        },
        "parametros": {
            "gas_used": GAS_USED,
            "minimo_treino_h": MINIMO_TREINO,
            "usd_por_eth": args.usd_por_eth,
            "perfis_de_gas": PERFIS_DE_GAS,
        },
        "cenarios": [],
    }

    print(f"corpus: {len(serie)}h de mainnet, {serie.index[0]} a {serie.index[-1]}")
    print(f"gwei: min {serie.min():.4f} · mediana {serie.median():.4f} · max {serie.max():.4f}\n")
    print(f"{'N':>5} {'prazo':>6} {'origens':>8} {'solver':>9} {'uniforme':>9} {'oraculo':>9} "
          f"{'mediana':>9} {'p05':>9} {'nao piorou':>11}")
    print("-" * 90)

    for (n, h), obs in sorted(cenarios.items()):
        r = resumir_cenario(obs, n)
        r["horizonte_h"] = h
        saida["cenarios"].append(r)
        print(f"{n:>5} {h:>5}h {r['origens']:>8} "
              f"{r['economia_agregada_pct']:>8.1f}% {r['economia_uniforme_pct']:>8.1f}% "
              f"{r['economia_oraculo_pct']:>8.1f}% {r['mediana_pct']:>8.1f}% "
              f"{r['p05_pct']:>8.1f}% {r['nao_piorou']:>7}/{r['origens']:<3}")

    # Sensibilidade ao pico, no cenário de referência da apresentação.
    saida["sensibilidade"] = sensibilidade_ao_pico(serie, 24, 50)
    sp = saida["sensibilidade"]
    print(f"\nSensibilidade ao pico (N=50, 24h · limiar {sp['limiar_pico_gwei']:.3f} gwei, "
          f"{sp['horas_de_pico']} horas em {len(serie)}):")
    print(f"  todas as origens              {sp['todas']['economia_agregada_pct']:+7.2f}% "
          f"agregado · {sp['todas']['nao_piorou']}/{sp['todas']['origens']} não piorou")
    print(f"  excluindo horizontes com pico {sp['sem_pico']['economia_agregada_pct']:+7.2f}% "
          f"agregado · {sp['sem_pico']['nao_piorou']}/{sp['sem_pico']['origens']} não piorou")

    if args.json:
        args.json.write_text(json.dumps(saida, indent=2), encoding="utf-8")
        print(f"\ndados em {args.json}")


if __name__ == "__main__":
    main()
