import { useCallback, useState } from "react";
import type { Otimizacao, PedidoOtimizacao } from "../types";

/**
 * Guarda os últimos planos calculados, no navegador de quem usa.
 *
 * localStorage e não banco: uma tabela nova exigiria alterar o schema, e o
 * `db/init/` só roda com volume vazio -- aplicá-la hoje custaria os blocos de
 * mainnet já capturados, ou a migração para migrations versionadas. Para um
 * histórico de conveniência, que serve para comparar duas rodadas na mesma
 * sessão, o preço não se justifica.
 *
 * A consequência está assumida: o histórico é por navegador. Se a Alphractal
 * quiser histórico de verdade -- compartilhado, auditável --, é backend.
 */
const CHAVE = "fees-monitor:execucoes";

/** O suficiente para comparar rodadas sem a lista virar um segundo painel. */
const LIMITE = 8;

export interface Execucao {
  em: string;
  n_transacoes: number;
  horas_ate_deadline: number;
  gas_used: number;
  economia_pct: number;
  economia_usd: number | null;
  executar_agora: boolean;
}

/**
 * Toda leitura e escrita vai em try/catch: `localStorage` lança em aba anônima
 * com dados de site bloqueados, e um histórico de conveniência não pode
 * derrubar a tela do otimizador.
 */
function ler(): Execucao[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return [];
    const dados: unknown = JSON.parse(bruto);
    if (!Array.isArray(dados)) return [];
    // Filtra o que não tem a forma esperada: o conteúdo pode ter sido gravado
    // por uma versão anterior do app.
    return dados.filter(
      (e): e is Execucao =>
        typeof e === "object" && e !== null &&
        typeof (e as Execucao).em === "string" &&
        typeof (e as Execucao).n_transacoes === "number",
    ).slice(0, LIMITE);
  } catch {
    return [];
  }
}

export function useHistoricoDeExecucoes() {
  const [execucoes, setExecucoes] = useState<Execucao[]>(ler);

  const registrar = useCallback((pedido: PedidoOtimizacao, r: Otimizacao) => {
    const nova: Execucao = {
      em: new Date().toISOString(),
      n_transacoes: pedido.n_transacoes,
      horas_ate_deadline: pedido.horas_ate_deadline,
      gas_used: pedido.gas_used ?? 0,
      economia_pct: r.economia_pct,
      economia_usd: r.economia_usd,
      executar_agora: r.executar_agora,
    };
    setExecucoes((atuais) => {
      const lista = [nova, ...atuais].slice(0, LIMITE);
      try {
        localStorage.setItem(CHAVE, JSON.stringify(lista));
      } catch {
        // Cota estourada ou storage bloqueado: a lista segue em memória.
      }
      return lista;
    });
  }, []);

  const limpar = useCallback(() => {
    setExecucoes([]);
    try {
      localStorage.removeItem(CHAVE);
    } catch {
      // idem
    }
  }, []);

  return { execucoes, registrar, limpar };
}
