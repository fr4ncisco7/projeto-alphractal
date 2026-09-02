import { afterEach, describe, expect, it, vi } from "vitest";
import { assinar, publicar, totalAssinantes, type EventoBloco } from "../src/eventos.js";

/**
 * O Set de assinantes vive no escopo do módulo, então um teste que esquece de
 * cancelar contamina o próximo -- foi exatamente o que aconteceu ao escrever
 * estes testes. Cada `assinar` daqui registra o cancelamento para o afterEach.
 */
const pendentes: (() => void)[] = [];

function inscrever(fn: (e: EventoBloco) => void): () => void {
  const cancelar = assinar(fn);
  pendentes.push(cancelar);
  return cancelar;
}

afterEach(() => {
  pendentes.splice(0).forEach((cancelar) => cancelar());
});

function bloco(n: number): EventoBloco {
  return {
    momento: new Date().toISOString(),
    block_number: n,
    preco_gwei: 0.12,
    base_fee_gwei: 0.05,
    gas_used_ratio: 0.5,
  };
}

describe("barramento de eventos", () => {
  it("entrega o mesmo evento a todos os assinantes", () => {
    // O ponto do módulo: UMA assinatura com o nó alimenta N conexões SSE.
    const recebidos: number[][] = [[], [], []];
    const cancelar = recebidos.map((lista) => inscrever((e) => lista.push(e.block_number)));

    publicar(bloco(100));
    publicar(bloco(101));

    for (const lista of recebidos) expect(lista).toEqual([100, 101]);
    cancelar.forEach((fn) => fn());
  });

  it("a função devolvida remove o assinante", () => {
    const vistos: number[] = [];
    const cancelar = inscrever((e) => vistos.push(e.block_number));

    publicar(bloco(1));
    cancelar();
    publicar(bloco(2));

    expect(vistos).toEqual([1]);
    expect(totalAssinantes()).toBe(0);
  });

  it("cancelar duas vezes não quebra nem afeta outros assinantes", () => {
    const vistos: number[] = [];
    const cancelarA = inscrever(() => {});
    inscrever((e) => vistos.push(e.block_number));

    cancelarA();
    cancelarA();

    publicar(bloco(7));
    expect(vistos).toEqual([7]);
  });

  it("um assinante que lança não impede os demais de receber", () => {
    // É o caso real: uma conexão SSE que caiu no meio do write. Sem o
    // try/catch por assinante, ela derrubaria o laço da ingestão.
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const vistos: number[] = [];

    inscrever(() => { throw new Error("conexão morta"); });
    inscrever((e) => vistos.push(e.block_number));

    expect(() => publicar(bloco(42))).not.toThrow();
    expect(vistos).toEqual([42]);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("totalAssinantes acompanha entradas e saídas", () => {
    expect(totalAssinantes()).toBe(0);
    const a = inscrever(() => {});
    const b = inscrever(() => {});
    expect(totalAssinantes()).toBe(2);
    a();
    expect(totalAssinantes()).toBe(1);
    b();
    expect(totalAssinantes()).toBe(0);
  });

  it("publicar sem assinante nenhum é inofensivo", () => {
    expect(() => publicar(bloco(1))).not.toThrow();
  });
});
