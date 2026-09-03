import type { JanelaPlano } from "../types";

/**
 * Por que o solver mandou executar agora.
 *
 * A explicação que estava na tela — "a hora atual já é a mais barata prevista"
 * — é FALSA na maioria das vezes em que a trava dispara. Medido sobre o corpus:
 * com o teto em 10% de N, o MILP é obrigado a usar ~10 janelas, e ele descarta
 * o plano sempre que a média dessas 10 fica acima do preço de agora — o que
 * acontece mesmo havendo janelas 4x mais baratas disponíveis, porque não há
 * DEZ delas.
 *
 * A causa real é a aritmética do teto, não o preço de agora ser o menor. Dizer
 * a coisa errada aqui é pior que não dizer nada: quem lê "a hora atual já é a
 * mais barata" e vê no gráfico ao lado uma barra bem menor conclui, com razão,
 * que o sistema está quebrado.
 */
export interface MotivoDoAgora {
  /** Quantas janelas o teto obriga o MILP a usar. */
  janelasObrigatorias: number;
  /** Quantas janelas estão previstas mais baratas que a atual. */
  janelasMaisBaratas: number;
  /** A janela 0 é de fato a mais barata do horizonte? */
  agoraEhAMelhor: boolean;
}

export function motivoDoAgora(plano: JanelaPlano[], teto: number): MotivoDoAgora | null {
  if (plano.length === 0 || teto <= 0) return null;

  const custos = plano.map((j) => j.custo_i_gwei);
  const agora = custos[0];
  const total = plano.reduce((t, j) => t + j.x, 0);

  return {
    janelasObrigatorias: Math.ceil(total / teto),
    janelasMaisBaratas: custos.filter((c) => c < agora).length,
    agoraEhAMelhor: custos.every((c) => c >= agora),
  };
}

/** A frase, montada a partir do motivo real. */
export function frasePorQueAgora(m: MotivoDoAgora): string {
  if (m.agoraEhAMelhor) {
    return "A hora atual é a mais barata prevista em todo o prazo — não há janela melhor para esperar.";
  }
  return (
    `Existem ${m.janelasMaisBaratas} horas previstas mais baratas que agora, mas o teto por ` +
    `janela obriga a espalhar por pelo menos ${m.janelasObrigatorias} delas — e a média ` +
    `dessas ${m.janelasObrigatorias} fica acima do preço de agora.`
  );
}
