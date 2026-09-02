import { gwei, horaCurta } from "../lib/formato";
import type { JanelaPlano } from "../types";
import "../pages/pages.css";

/**
 * O custo previsto de cada janela, com as escolhidas destacadas.
 *
 * Substituiu, na tela inicial, uma fita que mostrava a QUANTIDADE de transações
 * por janela. Aquela figura tinha dois problemas: a altura não dizia o que
 * media -- e ninguém adivinha "número de transações" olhando para barras --, e
 * as janelas vazias viravam um tracinho que parecia eixo. Aqui a altura é
 * preço, que é a leitura que qualquer pessoa faz de um gráfico de barras ao
 * longo do tempo, e a quantidade vira rótulo em cima da barra escolhida.
 *
 * A linha tracejada no custo da janela 0 é o que faz a figura se explicar: ela
 * marca o preço de executar agora, e só há o que ganhar nas barras abaixo dela.
 */
export function CurvaPrevista({ plano, historicoAte, mostrarContagem = false }: {
  plano: JanelaPlano[];
  /** Fim do histórico enviado ao solver; a janela i cai em `historicoAte + i+1`. */
  historicoAte?: string;
  /** Rotula cada janela escolhida com quantas transações vão nela. */
  mostrarContagem?: boolean;
}) {
  const maximo = Math.max(...plano.map((j) => j.custo_i_gwei));
  const agora = plano[0]?.custo_i_gwei ?? 0;
  const escolhidas = plano.filter((j) => j.x > 0);

  if (!Number.isFinite(maximo) || maximo <= 0) return null;

  const relogio = (janela: number) =>
    historicoAte
      ? horaCurta(new Date(new Date(historicoAte).getTime() + (janela + 1) * 3_600_000).toISOString())
      : null;

  return (
    <>
      <div
        className={`curva${mostrarContagem ? " curva--rotulada" : ""}`}
        style={{ "--nivel-agora": `${(agora / maximo) * 100}%` } as React.CSSProperties}
        role="img"
        aria-label={
          `Custo previsto de gas em ${plano.length} janelas de 1 hora. ` +
          `O otimizador escolheu ${escolhidas.length}: ` +
          escolhidas.map((j) => `${j.x} transações em +${j.janela}h`).join(", ") + "."
        }
      >
        {plano.map((j) => (
          <span
            key={j.janela}
            className={`curva__janela${j.x > 0 ? " curva__janela--escolhida" : ""}`}
            style={{ "--altura": `${(j.custo_i_gwei / maximo) * 100}%` } as React.CSSProperties}
            title={
              `${j.janela === 0 ? "agora" : `+${j.janela}h`}` +
              (relogio(j.janela) ? ` (${relogio(j.janela)})` : "") +
              `: ${gwei(j.custo_i_gwei)} gwei/gas` +
              (j.x > 0 ? ` · ${j.x} transações aqui` : "")
            }
          >
            {mostrarContagem && j.x > 0 && (
              <b className="curva__contagem" aria-hidden="true">{j.x}</b>
            )}
          </span>
        ))}
      </div>

      <p className="curva__eixo">
        <span>agora{relogio(0) && ` · ${relogio(0)}`}</span>
        <span className="curva__legenda">
          <i className="ponto ponto--escolhida" aria-hidden="true" /> janela escolhida
          <i className="ponto ponto--linha" aria-hidden="true" /> preço de agora
        </span>
        <span>
          +{plano.length - 1}h{relogio(plano.length - 1) && ` · ${relogio(plano.length - 1)}`}
        </span>
      </p>
    </>
  );
}
