import { gravarBlocos, type LinhaBloco } from "./db.js";
import { publicar } from "./eventos.js";
import { PERCENTIS, buscarFeeHistory, clienteWs } from "./rpc.js";

/**
 * Ingestão ao vivo: assina newHeads via WebSocket e grava um registro por
 * bloco (~12s). O header do newHeads já traz baseFeePerGas, gasUsed, gasLimit
 * e timestamp; falta só o priority fee, que é por transação e vem de um
 * eth_feeHistory de 1 bloco.
 *
 * Grava no HEAD, sem esperar finalidade. É o requisito do produto (§1 da
 * arquitetura: previsibilidade no momento da decisão), ao custo de
 * eventualmente gravar um bloco que sofre reorg -- raro e raso pós-merge.
 */
export function iniciarIngestaoAoVivo(): () => void {
  const cliente = clienteWs();
  let blocosGravados = 0;

  const parar = cliente.watchBlocks({
    emitMissed: true,          // recupera blocos perdidos numa queda de conexão
    onBlock: async (bloco) => {
      try {
        if (bloco.number === null || bloco.baseFeePerGas === null) return;

        const fh = await buscarFeeHistory(1, bloco.number);
        const recompensa = fh.reward[0] ?? [];

        const linha: LinhaBloco = {
          momento: new Date(Number(bloco.timestamp) * 1000),
          blockNumber: Number(bloco.number),
          baseFeeWei: bloco.baseFeePerGas.toString(),
          priorityFeeP25Wei: recompensa[0]?.toString() ?? null,
          priorityFeeP50Wei: (recompensa[1] ?? 0n).toString(),
          priorityFeeP75Wei: recompensa[2]?.toString() ?? null,
          gasUsedRatio: Number(bloco.gasUsed) / Number(bloco.gasLimit),
          gasUsed: bloco.gasUsed.toString(),
          gasLimit: bloco.gasLimit.toString(),
        };

        const n = await gravarBlocos([linha]);
        blocosGravados += n;

        // Publica só o que foi de fato gravado: bloco duplicado (n === 0) não
        // vira evento, senão o painel desenharia o mesmo ponto duas vezes na
        // sobreposição entre backfill e ingestão ao vivo.
        if (n > 0) {
          const priority = BigInt(linha.priorityFeeP50Wei);
          const base = BigInt(linha.baseFeeWei);
          publicar({
            momento: linha.momento.toISOString(),
            block_number: linha.blockNumber,
            preco_gwei: Number(base + priority) / 1e9,
            base_fee_gwei: Number(base) / 1e9,
            gas_used_ratio: linha.gasUsedRatio,
          });
        }
        if (blocosGravados % 25 === 1) {
          const gwei = Number(bloco.baseFeePerGas) / 1e9;
          console.log(`[ingestao] bloco ${bloco.number} base_fee=${gwei.toFixed(4)} gwei ` +
                      `(${blocosGravados} gravados)`);
        }
      } catch (erro) {
        // Não derruba a assinatura por causa de um bloco: o próximo vem em 12s.
        console.error(`[ingestao] falha no bloco ${bloco.number}:`, erro);
      }
    },
    onError: (erro) => console.error("[ingestao] erro na assinatura:", erro),
  });

  console.log(`[ingestao] assinando newHeads (percentis de tip: ${PERCENTIS.join("/")})`);
  return parar;
}
