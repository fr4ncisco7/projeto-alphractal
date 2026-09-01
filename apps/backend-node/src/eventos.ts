/**
 * Barramento de eventos em memória, entre a ingestão e as conexões SSE.
 *
 * Por que existe: a ingestão não deve saber que HTTP existe, e o endpoint de
 * stream não deve saber de onde o bloco veio. Este módulo é o único ponto de
 * contato entre os dois.
 *
 * Por que em memória e não Redis: um único processo Node atende todas as
 * conexões, e todo mundo recebe exatamente o mesmo evento -- não há estado por
 * usuário, nem fila, nem entrega garantida a implementar. Se um dia houver mais
 * de uma instância do backend, aí sim cada uma precisaria da sua fonte de
 * eventos (ou de um Redis pub/sub no meio); hoje seria complexidade sem uso.
 *
 * O bloco é entregue a N assinantes a partir de UMA assinatura WebSocket com o
 * nó Ethereum. É essa a razão de a conexão com o nó morar no backend e não no
 * navegador: com N usuários conectando direto seriam N assinaturas na mesma
 * chave de RPC (estourando o rate limit), e a chave ficaria exposta no código
 * do frontend.
 */

export interface EventoBloco {
  momento: string;          // ISO-8601
  block_number: number;
  preco_gwei: number;       // base_fee + priority_fee p50
  base_fee_gwei: number;
  gas_used_ratio: number;
}

type Assinante = (evento: EventoBloco) => void;

const assinantes = new Set<Assinante>();

/** Registra um ouvinte. Devolve a função que o remove. */
export function assinar(fn: Assinante): () => void {
  assinantes.add(fn);
  return () => {
    assinantes.delete(fn);
  };
}

/**
 * Publica para todos os ouvintes.
 *
 * Cada entrega vai em try/catch isolado: um assinante que lança (conexão que
 * caiu no meio do write, por exemplo) não pode impedir os demais de receber,
 * nem derrubar o laço da ingestão que chamou daqui.
 */
export function publicar(evento: EventoBloco): void {
  for (const fn of assinantes) {
    try {
      fn(evento);
    } catch (erro) {
      console.error("[eventos] assinante falhou:", erro);
    }
  }
}

export function totalAssinantes(): number {
  return assinantes.size;
}
