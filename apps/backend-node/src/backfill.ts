/**
 * Backfill de histórico -- roda sob demanda: `npm run backfill -- <horas>`
 *
 * Existe porque o estimador precisa de ~4 semanas de histórico (decisão 8) e
 * a ingestão ao vivo levaria 4 semanas para acumular isso.
 *
 * Usa eth_feeHistory em lotes de 1024 blocos: ~200 chamadas para 4 semanas,
 * contra ~200 mil se fosse header a header. O custo é que feeHistory não
 * devolve gasUsed/gasLimit nem timestamp -- daí gas_used/gas_limit ficarem
 * NULL nestas linhas e o momento vir interpolado entre as pontas do lote
 * (ver feeHistoryParaLinhas em rpc.ts).
 *
 * LIMITE DE HISTÓRICO DO PROVEDOR: pedir um bloco explícito muito atrás da
 * cabeça é "requisição de arquivo", que a maioria dos endpoints públicos
 * recusa sem chave. Medido no publicnode em 29/08/2026: `latest` com 1024
 * blocos funciona (3,4h), mas bloco explícito só até ~32 blocos do topo.
 * Ou seja: no endpoint público o backfill para em ~3,4h. Para as ~4 semanas
 * que o estimador precisa (decisão 8), é necessário Alchemy/Infura com chave.
 * Quando o limite é atingido, o backfill para limpo e avisa -- não estoura.
 */

/** O provedor recusou histórico profundo por falta de chave de arquivo. */
function ehLimiteDeArquivo(erro: unknown): boolean {
  const texto = String((erro as { cause?: { message?: string } })?.cause?.message ?? erro);
  return /archive|personal token|not available|too old|history/i.test(texto);
}
import { gravarBlocos, pool } from "./db.js";
import { blocosAncora, buscarFeeHistory, clienteHttp, feeHistoryParaLinhas,
         timestampDoBloco, type Ancora } from "./rpc.js";

const BLOCOS_POR_LOTE = 1024;
const SEGUNDOS_POR_BLOCO = 12;

export async function backfill(horas: number): Promise<number> {
  const blocosAlvo = Math.ceil((horas * 3600) / SEGUNDOS_POR_BLOCO);
  const cabeca = await clienteHttp.getBlockNumber();

  console.log(`[backfill] ${horas}h ≈ ${blocosAlvo.toLocaleString()} blocos, ` +
              `a partir do bloco ${cabeca}`);

  // O primeiro lote usa "latest": em vários provedores públicos essa é a
  // única forma de puxar 1024 blocos sem cair na regra de arquivo.
  let fim: bigint | "latest" = "latest";
  let restantes = blocosAlvo;
  let gravados = 0;
  let lote = 0;

  while (restantes > 0) {
    const tamanho = Math.min(BLOCOS_POR_LOTE, restantes);

    let fh;
    try {
      fh = await buscarFeeHistory(tamanho, fim);
    } catch (erro) {
      if (ehLimiteDeArquivo(erro)) {
        const horasObtidas = ((blocosAlvo - restantes) * SEGUNDOS_POR_BLOCO) / 3600;
        console.warn(
          `\n[backfill] o provedor recusou histórico mais profundo (requisição de arquivo).\n` +
          `           Obtidas ~${horasObtidas.toFixed(1)}h das ${horas}h pedidas.\n` +
          `           Para ir mais fundo, configure RPC_HTTP_URL com uma chave ` +
          `Alchemy/Infura.`,
        );
        break;
      }
      throw erro;
    }
    if (fh.gasUsedRatio.length === 0) break;

    const primeiro = fh.oldestBlock;

    // Timestamps reais a cada 128 blocos; o miolo entre âncoras é interpolado.
    const numeros = blocosAncora(primeiro, fh.gasUsedRatio.length);
    const ancoras: Ancora[] = await Promise.all(
      numeros.map(async (bloco) => ({ bloco, momento: await timestampDoBloco(bloco) })),
    );
    const tIni = ancoras[0].momento;

    gravados += await gravarBlocos(feeHistoryParaLinhas(fh, ancoras));

    restantes -= fh.gasUsedRatio.length;
    fim = primeiro - 1n;
    lote += 1;
    if (lote % 10 === 0 || restantes <= 0) {
      console.log(`[backfill] lote ${lote}: ${gravados.toLocaleString()} gravados, ` +
                  `${Math.max(restantes, 0).toLocaleString()} restantes ` +
                  `(em ${tIni.toISOString().slice(0, 16)})`);
    }
  }

  console.log(`[backfill] concluído: ${gravados.toLocaleString()} blocos`);

  if (gravados > 0) await reprocessarAgregados(horas);
  return gravados;
}

/**
 * Reprocessa `gas_1min` e `gas_1h` sobre a janela recém-preenchida.
 *
 * As agregações contínuas têm `materialized_only = false`, o que faz o dado
 * NOVO aparecer na hora -- mas isso vale só para o que chega DEPOIS da marca
 * d'água de materialização. O backfill escreve ATRÁS dela, em buckets que a
 * Timescale já considera calculados, e por isso não são recalculados sozinhos.
 *
 * O sintoma é traiçoeiro: `bloco_gas` fica correto, o backfill relata sucesso,
 * e mesmo assim o painel e o solver continuam enxergando o buraco. Aconteceu de
 * verdade em 02/09/2026 -- 6.193 blocos gravados e a série horária seguiu com
 * um vão de 17h, que só sumiu com o refresh manual.
 *
 * A margem de um dia para trás cobre o bucket parcial na borda da janela.
 */
async function reprocessarAgregados(horas: number): Promise<void> {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - (horas + 24) * 3_600_000);

  for (const agregado of ["gas_1min", "gas_1h"]) {
    // CALL não pode rodar dentro de transação; o pg só abre uma se pedirmos.
    await pool.query(
      `CALL refresh_continuous_aggregate('${agregado}', $1::timestamptz, $2::timestamptz)`,
      [inicio, fim],
    );
  }
  console.log(`[backfill] agregados reprocessados desde ${inicio.toISOString().slice(0, 16)}`);
}

// Entrada de linha de comando
const horas = Number(process.argv[2] ?? 24);
backfill(horas)
  .then(() => pool.end())
  .catch((e) => { console.error("[backfill] falhou:", e); pool.end(); process.exit(1); });
