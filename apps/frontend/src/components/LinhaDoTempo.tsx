import { gwei, horaCurta } from "../lib/formato";
import type { JanelaPlano, PontoSerie } from "../types";
import "../pages/pages.css";

/**
 * Histórico real e previsão numa série só, com as janelas escolhidas marcadas.
 *
 * O painel já mostrava a previsão isolada, e previsão isolada não justifica
 * nada: quem olha não tem como saber se aquele vale das 3h é um padrão que se
 * repete todo dia ou um palpite do modelo. Emendando as duas na mesma linha, o
 * ritmo diário aparece à esquerda do divisor e o plano aparece à direita
 * caindo nos mesmos horários -- que é a justificativa da escolha.
 *
 * A altura é comum às duas metades (escala única): fosse uma escala por lado,
 * a comparação visual entre real e previsto seria falsa.
 */

export interface BarraLinha {
  momento: Date;
  gwei: number;
  previsto: boolean;
  transacoes: number;
}

export function montarLinha(
  historico: PontoSerie[],
  plano: JanelaPlano[],
  historicoAte: string,
  horasDeHistorico: number,
): BarraLinha[] {
  const fimHistorico = new Date(historicoAte).getTime();
  const inicio = fimHistorico - (horasDeHistorico - 1) * 3_600_000;

  const reais: BarraLinha[] = historico
    .filter((p) => {
      const t = new Date(p.momento).getTime();
      return t >= inicio && t <= fimHistorico;
    })
    .map((p) => ({
      momento: new Date(p.momento),
      gwei: p.media_gwei,
      previsto: false,
      transacoes: 0,
    }));

  // A janela i cobre `historico_ate + (i+1)h`: o estimador prevê a partir da
  // hora seguinte ao fim do histórico.
  const previstas: BarraLinha[] = plano.map((j) => ({
    momento: new Date(fimHistorico + (j.janela + 1) * 3_600_000),
    gwei: j.custo_i_gwei,
    previsto: true,
    transacoes: j.x,
  }));

  return [...reais, ...previstas];
}

export function LinhaDoTempo({ barras }: { barras: BarraLinha[] }) {
  const maximo = Math.max(...barras.map((b) => b.gwei));
  if (!Number.isFinite(maximo) || maximo <= 0) return null;

  const primeiraPrevista = barras.findIndex((b) => b.previsto);
  const reais = barras.filter((b) => !b.previsto);

  return (
    <>
      <div className="linha" role="img"
           aria-label="Preço real das últimas horas seguido da previsão do horizonte">
        {barras.map((b, i) => (
          <span
            key={b.momento.toISOString()}
            className={
              "linha__barra" +
              (b.previsto ? " linha__barra--prevista" : "") +
              (b.transacoes > 0 ? " linha__barra--escolhida" : "") +
              (i === primeiraPrevista ? " linha__barra--divisor" : "")
            }
            style={{ "--altura": `${(b.gwei / maximo) * 100}%` } as React.CSSProperties}
            title={
              `${b.momento.toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ` +
              `${gwei(b.gwei)} gwei ${b.previsto ? "(previsto)" : "(real)"}` +
              (b.transacoes > 0 ? ` · ${b.transacoes} transações` : "")
            }
          />
        ))}
      </div>

      <p className="linha__eixo">
        <span>{reais.length > 0 ? horaCurta(reais[0].momento.toISOString()) : ""}</span>
        <span className="linha__marca">
          ↑ agora{primeiraPrevista >= 0 &&
            ` · ${horaCurta(barras[primeiraPrevista].momento.toISOString())}`}
        </span>
        <span>{horaCurta(barras[barras.length - 1].momento.toISOString())}</span>
      </p>

      <p className="linha__legenda">
        <span><i className="ponto ponto--real" aria-hidden="true" /> preço real</span>
        <span><i className="ponto ponto--previsto" aria-hidden="true" /> previsto</span>
        <span><i className="ponto ponto--escolhida" aria-hidden="true" /> janela escolhida</span>
      </p>
    </>
  );
}
