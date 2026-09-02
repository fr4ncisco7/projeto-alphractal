"""
Backtest walk-forward do otimizador sobre serie real de mainnet.

A pergunta que este arquivo existe para responder: **a economia que o otimizador
promete se concretiza?**

O `economia_pct` devolvido pelo `/optimize` compara o custo do plano com o custo
do baseline usando, nos DOIS lados, os custos PREVISTOS pelo estimador. O modelo
esta' avaliando a si mesmo. Se a previsao errar, o ganho realizado e' outro --
podendo ser negativo mesmo onde o numero prometido era positivo.

Aqui o plano continua nascendo da previsao, mas e' **cobrado pelo preco real**:

    treinar(serie[:t]) -> prever(H) -> otimizar(...) -> x
    custo realizado    =  sum_i  x_i * GAS_USED * custo_REAL[t+i]

Quatro estrategias sao comparadas em cada origem:

    agora     todas as N na janela 0            -- o que se faz sem a ferramenta
    plano     MILP sobre o custo PREVISTO       -- o produto
    oraculo   MILP sobre o custo REAL           -- o teto do que era alcancavel
    uniforme  N/M por janela                    -- o ingenuo, para o MILP superar

O oraculo roda com as MESMAS restricoes (teto, integralidade, trava de
dominancia), entao ele nao e' um limite teorico inatingivel: e' exatamente o que
este otimizador teria feito com previsao perfeita. A distancia entre `plano` e
`oraculo` isola o erro do estimador do merito da formulacao.

Uso:  ./scripts/backtest.sh            (roda no container, como os testes)
"""

from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from otimizador import otimizar

CORPUS_PADRAO = Path(__file__).parent / "tests" / "dados" / "mainnet_1h.csv"

# Mesmo minimo que o `/optimize` exige: 2 ciclos sazonais de 24h.
MINIMO_TREINO = 48
GAS_USED = 21_000


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------

def carregar_corpus(caminho: Path) -> pd.Series:
    """
    Le o CSV e devolve o MAIOR TRECHO CONTIGUO.

    A serie capturada tem buracos (a maquina de captura ficou desligada uma
    noite). O estimador exige serie horaria sem furos, e uma janela de teste que
    atravessasse um buraco compararia previsao com um preco de 21h depois. Em
    vez de interpolar -- o que inventaria dado e inflaria artificialmente a
    qualidade da previsao -- o backtest simplesmente usa o maior pedaco inteiro.
    """
    quadro = pd.read_csv(caminho, parse_dates=["momento"])
    serie = pd.Series(quadro["gwei"].values, index=pd.DatetimeIndex(quadro["momento"]))
    serie = serie.sort_index()

    passo = pd.Timedelta(hours=1)
    inicio_atual = 0
    melhor = (0, 0)
    for i in range(1, len(serie)):
        if serie.index[i] - serie.index[i - 1] != passo:
            if i - inicio_atual > melhor[1] - melhor[0]:
                melhor = (inicio_atual, i)
            inicio_atual = i
    if len(serie) - inicio_atual > melhor[1] - melhor[0]:
        melhor = (inicio_atual, len(serie))

    trecho = serie.iloc[melhor[0]:melhor[1]]
    trecho.index.freq = "h"
    return trecho


# ---------------------------------------------------------------------------
# Uma origem
# ---------------------------------------------------------------------------

@dataclass
class Observacao:
    origem: pd.Timestamp
    custo_agora: float
    custo_plano: float
    custo_oraculo: float
    custo_uniforme: float

    @property
    def economia_plano_pct(self) -> float:
        return 100.0 * (1 - self.custo_plano / self.custo_agora)

    @property
    def economia_oraculo_pct(self) -> float:
        return 100.0 * (1 - self.custo_oraculo / self.custo_agora)

    @property
    def economia_uniforme_pct(self) -> float:
        return 100.0 * (1 - self.custo_uniforme / self.custo_agora)

    @property
    def captura_pct(self) -> float | None:
        """
        Quanto da economia ALCANCAVEL o plano capturou.

        `None` quando o oraculo tambem nao tinha nada a ganhar (a janela 0 ja'
        era a melhor): dividir por zero ali nao mede qualidade de previsao
        nenhuma, so' geraria ruido na mediana.
        """
        alcancavel = self.custo_agora - self.custo_oraculo
        if alcancavel <= 1e-12:
            return None
        return 100.0 * (self.custo_agora - self.custo_plano) / alcancavel


def _custo_real(x: np.ndarray, reais: np.ndarray) -> float:
    return float(np.sum(x * GAS_USED * reais))


def _plano_uniforme(n_transacoes: int, n_janelas: int) -> np.ndarray:
    """N/M por janela, com o resto distribuido nas primeiras."""
    base, resto = divmod(n_transacoes, n_janelas)
    x = np.full(n_janelas, base, dtype=int)
    x[:resto] += 1
    return x


def avaliar_origem(previstos: np.ndarray, reais: np.ndarray,
                   origem: pd.Timestamp, n_transacoes: int) -> Observacao:
    horizonte = len(reais)

    plano = otimizar(previstos, n_transacoes, GAS_USED)
    oraculo = otimizar(reais, n_transacoes, GAS_USED)

    return Observacao(
        origem=origem,
        custo_agora=float(n_transacoes * GAS_USED * reais[0]),
        # O plano nasce da previsao e e' cobrado pelo preco real. E' esta linha
        # que separa este backtest do `economia_pct` do endpoint.
        custo_plano=_custo_real(plano.x, reais),
        custo_oraculo=_custo_real(oraculo.x, reais),
        custo_uniforme=_custo_real(_plano_uniforme(n_transacoes, horizonte), reais),
    )


# ---------------------------------------------------------------------------
# Varredura
# ---------------------------------------------------------------------------

def rodar(serie: pd.Series, horizontes: list[int], enes: list[int],
          minimo_treino: int = MINIMO_TREINO) -> dict[tuple[int, int], list[Observacao]]:
    """
    Walk-forward: cada hora da serie que tenha treino suficiente antes e
    horizonte inteiro depois vira uma origem.

    O modelo e' treinado UMA vez por origem e a previsao e' feita no horizonte
    mais longo, fatiada para os menores. `forecast` do Holt-Winters e' recursivo
    e deterministico, entao `prever(m, 24)[:6] == prever(m, 6)` -- verificado por
    asercao na primeira origem, para a otimizacao nao virar uma suposicao.
    """
    # Import tardio: statsmodels custa segundos para carregar, e quem so' quiser
    # `carregar_corpus` (os testes) nao deve pagar isso.
    from estimador_custo import prever, treinar

    horizonte_max = max(horizontes)
    resultados: dict[tuple[int, int], list[Observacao]] = {
        (n, h): [] for n in enes for h in horizontes
    }

    ultimo_inicio = len(serie) - horizonte_max
    if ultimo_inicio <= minimo_treino:
        raise SystemExit(
            f"serie de {len(serie)}h nao comporta treino de {minimo_treino}h "
            f"mais horizonte de {horizonte_max}h"
        )

    verificado = False
    for t in range(minimo_treino, ultimo_inicio + 1):
        modelo = treinar(serie.iloc[:t])
        previsao = prever(modelo, horizonte_max)

        if not verificado:
            assert np.allclose(prever(modelo, min(horizontes)), previsao[:min(horizontes)]), \
                "fatiar a previsao mais longa nao equivale a prever o horizonte curto"
            verificado = True

        for h in horizontes:
            reais = serie.iloc[t:t + h].to_numpy()
            if len(reais) < h:
                continue
            for n in enes:
                resultados[(n, h)].append(
                    avaliar_origem(previsao[:h], reais, serie.index[t], n)
                )

    return resultados


# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------

def _quartis(valores: list[float]) -> tuple[float, float, float]:
    ordenados = sorted(valores)
    if len(ordenados) < 4:
        m = statistics.median(ordenados)
        return m, m, m
    q1, _, q3 = statistics.quantiles(ordenados, n=4)
    return q1, statistics.median(ordenados), q3


def resumir(resultados: dict[tuple[int, int], list[Observacao]]) -> str:
    linhas = [
        "| N | horizonte | origens | economia do plano (mediana, p25–p75) | oráculo | uniforme | captura | plano ≥ agora |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for (n, h), obs in sorted(resultados.items()):
        if not obs:
            continue
        p25, mediana, p75 = _quartis([o.economia_plano_pct for o in obs])
        med_oraculo = statistics.median([o.economia_oraculo_pct for o in obs])
        med_uniforme = statistics.median([o.economia_uniforme_pct for o in obs])

        capturas = [o.captura_pct for o in obs if o.captura_pct is not None]
        texto_captura = f"{statistics.median(capturas):.0f}%" if capturas else "—"

        # Fracao das origens em que seguir o plano NAO saiu pior que executar
        # tudo agora. E' a garantia pratica que interessa a quem usa.
        nao_piorou = sum(1 for o in obs if o.custo_plano <= o.custo_agora + 1e-9)

        linhas.append(
            f"| {n} | {h}h | {len(obs)} | **{mediana:+.1f}%** ({p25:+.1f} – {p75:+.1f}) | "
            f"{med_oraculo:+.1f}% | {med_uniforme:+.1f}% | {texto_captura} | "
            f"{nao_piorou}/{len(obs)} |"
        )
    return "\n".join(linhas)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, default=CORPUS_PADRAO)
    p.add_argument("--horizontes", type=int, nargs="+", default=[6, 12, 24])
    p.add_argument("--enes", type=int, nargs="+", default=[10, 50])
    p.add_argument("--saida", type=Path, default=None, help="grava o relatorio em markdown")
    args = p.parse_args()

    serie = carregar_corpus(args.corpus)
    print(f"corpus: {len(serie)}h contiguas, de {serie.index[0]} a {serie.index[-1]}")
    print(f"treino minimo {MINIMO_TREINO}h · gas_used {GAS_USED:,} · horizontes {args.horizontes}\n")

    resultados = rodar(serie, args.horizontes, args.enes)
    tabela = resumir(resultados)
    print(tabela)

    if args.saida:
        args.saida.write_text(
            f"# Backtest do otimizador\n\n"
            f"Corpus: {len(serie)}h contíguas de mainnet, "
            f"{serie.index[0]:%d/%m %H:%M} a {serie.index[-1]:%d/%m %H:%M} UTC.\n"
            f"Treino mínimo {MINIMO_TREINO}h, `gas_used` {GAS_USED:,}.\n\n"
            f"{tabela}\n",
            encoding="utf-8",
        )
        print(f"\nrelatorio em {args.saida}")


if __name__ == "__main__":
    main()
