import { createPublicClient, http, webSocket } from "viem";
import { mainnet } from "viem/chains";
import { config } from "./config.js";
import type { LinhaBloco } from "./db.js";

export const clienteHttp = createPublicClient({
  chain: mainnet,
  transport: http(config.rpcHttpUrl),
});

export const clienteWs = () => createPublicClient({
  chain: mainnet,
  transport: webSocket(config.rpcWsUrl),
});

/** Percentis de priority fee que gravamos (decisão 2: o p50 alimenta o preço
 *  efetivo; p25/p75 ficam de graça e permitem estudar dispersão do tip). */
export const PERCENTIS = [25, 50, 75] as const;

export interface FeeHistory {
  oldestBlock: bigint;
  baseFeePerGas: bigint[];   // tamanho = blocos + 1 (inclui o próximo bloco)
  gasUsedRatio: number[];    // tamanho = blocos
  reward: bigint[][];        // tamanho = blocos, cada um com 3 percentis
}

export async function buscarFeeHistory(blocos: number, ateBloco: bigint | "latest"): Promise<FeeHistory> {
  // O tipo do viem é uma união: ou `blockNumber`, ou `blockTag` -- as duas
  // chaves não podem coexistir no objeto, nem mesmo com valor undefined.
  const r = await clienteHttp.getFeeHistory(
    ateBloco === "latest"
      ? { blockCount: blocos, blockTag: "latest", rewardPercentiles: [...PERCENTIS] }
      : { blockCount: blocos, blockNumber: ateBloco, rewardPercentiles: [...PERCENTIS] },
  );
  return {
    oldestBlock: r.oldestBlock,
    baseFeePerGas: r.baseFeePerGas,
    gasUsedRatio: r.gasUsedRatio,
    reward: (r.reward ?? []) as bigint[][],
  };
}

export async function timestampDoBloco(numero: bigint): Promise<Date> {
  const b = await clienteHttp.getBlock({ blockNumber: numero, includeTransactions: false });
  return new Date(Number(b.timestamp) * 1000);
}

/** Bloco com timestamp REAL, usado como âncora da interpolação. */
export interface Ancora { bloco: bigint; momento: Date; }

/** Quantos blocos entre âncoras. Menor = mais preciso e mais chamadas RPC. */
export const BLOCOS_POR_ANCORA = 128;

/** Números de bloco em que buscar timestamp real dentro de um lote. */
export function blocosAncora(primeiro: bigint, quantidade: number): bigint[] {
  const ancoras: bigint[] = [];
  for (let i = 0; i < quantidade; i += BLOCOS_POR_ANCORA) ancoras.push(primeiro + BigInt(i));
  const ultimo = primeiro + BigInt(quantidade - 1);
  if (ancoras[ancoras.length - 1] !== ultimo) ancoras.push(ultimo);
  return ancoras;
}

/** Interpola linearmente o momento de `bloco` entre as âncoras que o cercam. */
function momentoInterpolado(bloco: bigint, ancoras: Ancora[]): Date {
  if (ancoras.length === 1) return ancoras[0].momento;

  let j = 0;
  while (j < ancoras.length - 2 && ancoras[j + 1].bloco <= bloco) j += 1;
  const a = ancoras[j];
  const b = ancoras[j + 1];

  const vao = Number(b.bloco - a.bloco);
  const fracao = vao === 0 ? 0 : Number(bloco - a.bloco) / vao;
  return new Date(Math.round(a.momento.getTime() + fracao * (b.momento.getTime() - a.momento.getTime())));
}

/**
 * Converte um feeHistory em linhas prontas para gravar.
 *
 * `momento` vem por interpolação linear POR TRECHOS entre âncoras de
 * timestamp real (uma a cada BLOCOS_POR_ANCORA). Motivo: eth_feeHistory não
 * devolve timestamp, e buscar o header de cada bloco seriam ~200 mil chamadas
 * para 4 semanas.
 *
 * Pós-merge os slots são de 12s exatos, mas slot perdido (~0,5-1%) faz o
 * relógio real descolar da contagem de blocos. Com âncora só nas pontas de um
 * lote de 1024, esse descolamento chegou a 12s medido -- um bloco inteiro,
 * o bastante para jogar o registro no balde de 1min errado. Ancorando a cada
 * 128 blocos o erro cai para poucos segundos, ao custo de ~9 chamadas por
 * lote em vez de 2.
 */
export function feeHistoryParaLinhas(fh: FeeHistory, ancoras: Ancora[]): LinhaBloco[] {
  const n = fh.gasUsedRatio.length;
  if (n === 0 || ancoras.length === 0) return [];

  return Array.from({ length: n }, (_, i) => ({
    momento: momentoInterpolado(fh.oldestBlock + BigInt(i), ancoras),
    blockNumber: Number(fh.oldestBlock) + i,
    baseFeeWei: fh.baseFeePerGas[i].toString(),
    priorityFeeP25Wei: fh.reward[i]?.[0]?.toString() ?? null,
    priorityFeeP50Wei: (fh.reward[i]?.[1] ?? 0n).toString(),
    priorityFeeP75Wei: fh.reward[i]?.[2]?.toString() ?? null,
    gasUsedRatio: fh.gasUsedRatio[i],
    gasUsed: null,
    gasLimit: null,
  }));
}
