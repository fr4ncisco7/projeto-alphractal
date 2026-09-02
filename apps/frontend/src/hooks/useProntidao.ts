import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { ApiError } from "../lib/errors";
import { endpoints } from "../lib/endpoints";
import { gwei, usd } from "../lib/formato";
import type { Cotacao, EstatisticasDia, Saude } from "../types";

/**
 * Tempo mínimo que a abertura fica na tela, em ms.
 *
 * Contra a rede local as três checagens voltam em algumas dezenas de
 * milissegundos, e uma tela que aparece e some nesse intervalo lê como um
 * defeito de renderização, não como uma abertura. O piso não atrasa nada: as
 * requisições e a montagem do painel acontecem por baixo, durante a espera.
 */
const TEMPO_MINIMO_MS = 900;

export type EstadoDaVerificacao = "esperando" | "ok" | "falhou";

export type Verificacao = {
  chave: "backend" | "cotacao" | "dados";
  rotulo: string;
  estado: EstadoDaVerificacao;
  /** O que a checagem encontrou -- ou por que falhou. */
  detalhe: string | null;
  /** Sem esta, o painel não tem como funcionar. */
  essencial: boolean;
};

const INICIAL: Verificacao[] = [
  { chave: "backend", rotulo: "Backend e banco", estado: "esperando", detalhe: null, essencial: true },
  { chave: "cotacao", rotulo: "Cotação ETH/USD", estado: "esperando", detalhe: null, essencial: false },
  { chave: "dados", rotulo: "Dados do dia", estado: "esperando", detalhe: null, essencial: false },
];

/**
 * Checa, de verdade, se o painel tem o que precisa para abrir.
 *
 * As três chamadas saem em paralelo e cada uma acende sozinha -- é por isso que
 * são três requisições separadas e não uma só: uma resposta única faria os três
 * itens acenderem no mesmo instante, e escalonar isso na mão seria encenação.
 *
 * Só o `/health` bloqueia. Sem cotação o painel mostra gwei em vez de dólar, e
 * sem as estatísticas do dia cada tela tem seu próprio estado de carregamento;
 * nenhuma das duas justifica segurar a aplicação inteira na porta.
 */
export function useProntidao() {
  const [verificacoes, setVerificacoes] = useState<Verificacao[]>(INICIAL);
  const [tempoCumprido, setTempoCumprido] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  const atualizar = useCallback(
    (chave: Verificacao["chave"], estado: EstadoDaVerificacao, detalhe: string | null) => {
      setVerificacoes((atuais) =>
        atuais.map((v) => (v.chave === chave ? { ...v, estado, detalhe } : v)),
      );
    },
    [],
  );

  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();
    const { signal } = controlador;

    setVerificacoes(INICIAL);
    setTempoCumprido(false);
    const relogio = setTimeout(() => ativo && setTempoCumprido(true), TEMPO_MINIMO_MS);

    void apiRequest<Saude>(endpoints.saude, { signal })
      .then((s) => {
        if (!ativo) return;
        atualizar(
          "backend",
          "ok",
          `${s.blocos.toLocaleString("pt-BR")} blocos · ingestão ${s.ingestao} · otimizador ${
            s.solver === "ok" ? "disponível" : "inalcançável"
          }`,
        );
      })
      .catch((causa) => {
        if (!ativo || signal.aborted) return;
        atualizar("backend", "falhou", mensagem(causa));
      });

    void apiRequest<Cotacao>(endpoints.cotacao, { signal })
      .then((c) => ativo && atualizar("cotacao", "ok", `ETH a ${usd(c.usd_por_eth)} · via ${c.fonte}`))
      .catch((causa) => {
        if (!ativo || signal.aborted) return;
        atualizar("cotacao", "falhou", mensagem(causa));
      });

    void apiRequest<EstatisticasDia>(endpoints.gasEstatisticas, { signal })
      .then((e) => {
        if (!ativo) return;
        atualizar(
          "dados",
          "ok",
          e.blocos > 0
            ? `mediana de hoje em ${gwei(e.mediana_gwei)} gwei`
            : "nenhum bloco capturado hoje ainda",
        );
      })
      .catch((causa) => {
        if (!ativo || signal.aborted) return;
        atualizar("dados", "falhou", mensagem(causa));
      });

    return () => {
      ativo = false;
      clearTimeout(relogio);
      controlador.abort();
    };
  }, [atualizar, tentativa]);

  const backend = verificacoes.find((v) => v.chave === "backend")!;
  const resolvidas = verificacoes.filter((v) => v.estado !== "esperando").length;

  return {
    verificacoes,
    /** Fração de 0 a 1 -- alimenta a barra de progresso. */
    progresso: resolvidas / verificacoes.length,
    /** O painel já pode ser montado por baixo da abertura. */
    podeMontar: backend.estado === "ok",
    /** A abertura já pode sair de cena. */
    pronto: backend.estado === "ok" && resolvidas === verificacoes.length && tempoCumprido,
    bloqueado: backend.estado === "falhou",
    tentarDeNovo: () => setTentativa((n) => n + 1),
  };
}

function mensagem(causa: unknown): string {
  if (causa instanceof ApiError) return causa.message;
  // Quando não chega resposta nenhuma -- serviço fora do ar, porta errada,
  // CORS -- o fetch lança `TypeError: Failed to fetch`. Jogar isso na tela é
  // devolver ao usuário o vocabulário do navegador em inglês, e ainda por cima
  // sem dizer nada sobre o que fazer.
  return "serviço inalcançável";
}
