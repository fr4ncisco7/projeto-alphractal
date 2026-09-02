"""
Servico do solver -- FastAPI.

POST /optimize faz as duas etapas numa chamada so': estima custo_i a partir do
historico horario (estimador_custo.py, decisao 8) e resolve o MILP
(otimizador.py, decisoes 3/6/7/9).

O diagrama 9.2 da arquitetura poe a estimativa no backend Node, mas isso ficou
obsoleto quando a decisao 8 trocou "media movel" por Holt-Winters/statsmodels:
Node nao roda statsmodels. Por isso a estimativa mora aqui, junto do MILP.
"""

import math

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from estimador_custo import prever, treinar
from otimizador import otimizar

app = FastAPI(title="solver-python")

# Holt-Winters com sazonalidade de 24h precisa de pelo menos 2 ciclos completos.
MINIMO_HORAS_HISTORICO = 48
# Decisao 8 recomenda ~4 semanas para o fator de dia da semana ter dado suficiente.
RECOMENDADO_HORAS_HISTORICO = 672


class PontoHistorico(BaseModel):
    momento: str = Field(description="timestamp ISO-8601 da hora cheia")
    gwei: float = Field(ge=0, description="custo efetivo de gas (base + priority)")


class PedidoOtimizacao(BaseModel):
    historico: list[PontoHistorico] = Field(
        description="serie horaria contigua, tipicamente de serie_horaria() no banco"
    )
    n_transacoes: int = Field(ge=1, description="N -- transacoes restantes a executar")
    horas_ate_deadline: float = Field(
        gt=0,
        description="horizonte em horas; horizonte parcial e' TRUNCADO PARA BAIXO "
                    "(5,5h -> 5 janelas), para nunca recomendar execucao apos o prazo",
    )
    gas_used: int = Field(ge=1, description="de eth_estimateGas, unico para as N transacoes")


class JanelaPlano(BaseModel):
    janela: int
    x: int
    custo_i_gwei: float
    custo_janela_gwei: float


class RespostaOtimizacao(BaseModel):
    plano: list[JanelaPlano]
    custo_total_gwei: float
    custo_baseline_t0_gwei: float
    economia_pct: float
    executar_agora: bool
    custo_distribuido_gwei: float
    teto_por_janela: int
    n_janelas: int
    aviso: str | None = None


def _serie_do_historico(historico: list[PontoHistorico]) -> pd.Series:
    """Converte o payload em pandas.Series horaria, validando o que o
    estimador exige: DatetimeIndex, frequencia horaria e SEM buracos."""
    momentos = pd.to_datetime([p.momento for p in historico], utc=True, errors="coerce")
    if momentos.isna().any():
        raise HTTPException(422, "historico tem timestamp que nao e' ISO-8601 valido")

    serie = pd.Series([p.gwei for p in historico], index=momentos.tz_convert(None))
    serie = serie.sort_index()

    if serie.index.has_duplicates:
        raise HTTPException(422, "historico tem timestamps duplicados")

    # asfreq materializa qualquer hora faltante como NaN -- e' assim que buraco aparece.
    serie = serie.asfreq("h")
    if serie.isna().any():
        faltando = int(serie.isna().sum())
        raise HTTPException(
            422,
            f"historico tem {faltando} hora(s) faltando. O Holt-Winters sazonal quebra "
            f"com buraco -- use serie_horaria() no banco, que ja aplica gapfill.",
        )
    return serie


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/optimize", response_model=RespostaOtimizacao)
def optimize(pedido: PedidoOtimizacao):
    # Horizonte parcial truncado para baixo: nunca recomendar apos o deadline.
    n_janelas = math.floor(pedido.horas_ate_deadline)
    if n_janelas < 1:
        raise HTTPException(
            422,
            f"horizonte de {pedido.horas_ate_deadline}h trunca para 0 janelas de 1h; "
            f"nao ha' o que otimizar (execute imediatamente)",
        )

    serie = _serie_do_historico(pedido.historico)
    if len(serie) < MINIMO_HORAS_HISTORICO:
        raise HTTPException(
            422,
            f"historico tem {len(serie)}h; minimo {MINIMO_HORAS_HISTORICO}h "
            f"(2 ciclos sazonais de 24h)",
        )

    custo_i = prever(treinar(serie), horas_no_horizonte=n_janelas)
    if not np.all(np.isfinite(custo_i)):
        raise HTTPException(500, "estimador produziu custo nao finito")

    resultado = otimizar(custo_i, pedido.n_transacoes, pedido.gas_used)

    aviso = None
    if len(serie) < RECOMENDADO_HORAS_HISTORICO:
        aviso = (f"historico de {len(serie)}h abaixo das {RECOMENDADO_HORAS_HISTORICO}h "
                   f"(~4 semanas) recomendadas na decisao 8; fator de dia da semana pouco confiavel")

    return RespostaOtimizacao(
        plano=[
            JanelaPlano(
                janela=i,
                x=int(resultado.x[i]),
                custo_i_gwei=float(custo_i[i]),
                custo_janela_gwei=float(resultado.x[i] * pedido.gas_used * custo_i[i]),
            )
            for i in range(n_janelas)
        ],
        custo_total_gwei=resultado.custo_total_gwei,
        custo_baseline_t0_gwei=resultado.custo_baseline_t0_gwei,
        economia_pct=resultado.economia_pct,
        executar_agora=resultado.executar_agora,
        custo_distribuido_gwei=resultado.custo_distribuido_gwei,
        teto_por_janela=resultado.teto,
        n_janelas=n_janelas,
        aviso=aviso,
    )
