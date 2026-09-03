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

/**
 * Sem sinal de vida por este tempo, a assinatura é considerada morta.
 *
 * Blocos chegam a cada ~12s. 90s são sete blocos e meia: folga suficiente para
 * não brigar com a reconexão do próprio viem, que tenta antes de desistir, e
 * curto o bastante para o buraco na série ser irrelevante.
 */
const SEM_SINAL_MS = 90_000;
const INTERVALO_DO_VIGIA_MS = 30_000;

let ultimoSinalEm = 0;
let reconexoes = 0;
let assinaturaViva = false;

/**
 * Estado REAL da ingestão, para o /health não mentir.
 *
 * Antes o /health reportava `config.ingestaoAtiva` -- uma flag de configuração,
 * que diz se a ingestão foi LIGADA, não se ela está funcionando. Em 02/09/2026
 * o WebSocket caiu, o viem esgotou as tentativas de reconexão, e o painel
 * seguiu exibindo "ingestão ativa" com bolinha verde por 4,6 horas sem gravar
 * um único bloco. O único sinal honesto na tela era a defasagem em minutos.
 */
export function estadoDaIngestao() {
  return {
    viva: assinaturaViva && Date.now() - ultimoSinalEm < SEM_SINAL_MS,
    ultimoSinalEm: ultimoSinalEm ? new Date(ultimoSinalEm).toISOString() : null,
    reconexoes,
  };
}

function assinar(): () => void {
  const cliente = clienteWs();
  let blocosGravados = 0;
  assinaturaViva = true;
  ultimoSinalEm = Date.now();

  const parar = cliente.watchBlocks({
    emitMissed: true,          // recupera blocos perdidos numa queda de conexão
    onBlock: async (bloco) => {
      // Bloco chegou: a assinatura está viva, mesmo que este bloco venha a ser
      // descartado abaixo. É sinal de conexão, não de gravação.
      ultimoSinalEm = Date.now();

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
    onError: (erro) => {
      // Só registra: quem decide reconectar é o vigia. O viem tenta se
      // reconectar sozinho antes de emitir isto, e derrubar a assinatura aqui
      // atropelaria essa tentativa.
      console.error("[ingestao] erro na assinatura:", erro);
      assinaturaViva = false;
    },
  });

  console.log(`[ingestao] assinando newHeads (percentis de tip: ${PERCENTIS.join("/")})`);
  return parar;
}

/**
 * Supervisiona a assinatura e a refaz quando ela morre.
 *
 * A reconexão do viem é limitada: esgotadas as tentativas, `watchBlocks` fica
 * morto para sempre e nada no processo percebe. O vigia cobre esse caso e
 * também a morte SILENCIOSA -- socket que continua aberto mas para de entregar
 * newHeads --, porque o critério é "chegou bloco?", não "houve erro?".
 */
export function iniciarIngestaoAoVivo(): () => void {
  let pararAssinatura = assinar();

  const vigia = setInterval(() => {
    const parado = Date.now() - ultimoSinalEm;
    if (parado < SEM_SINAL_MS) return;

    reconexoes += 1;
    console.warn(
      `[ingestao] sem bloco há ${Math.round(parado / 1000)}s — refazendo a ` +
      `assinatura (reconexão nº ${reconexoes})`,
    );

    try {
      pararAssinatura();
    } catch (erro) {
      // A assinatura antiga pode já estar em estado inválido; não pode impedir
      // a nova de subir.
      console.error("[ingestao] falha ao encerrar a assinatura anterior:", erro);
    }
    pararAssinatura = assinar();
  }, INTERVALO_DO_VIGIA_MS);

  return () => {
    clearInterval(vigia);
    assinaturaViva = false;
    pararAssinatura();
  };
}
