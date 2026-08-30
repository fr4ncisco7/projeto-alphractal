import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.databaseUrl });

/** Uma linha de bloco_gas. Wei como string: BIGINT do Postgres não cabe em
 *  number do JS (2^53), e o driver pg aceita string para BIGINT. */
export interface LinhaBloco {
  momento: Date;
  blockNumber: number;
  baseFeeWei: string;
  priorityFeeP25Wei: string | null;
  priorityFeeP50Wei: string;
  priorityFeeP75Wei: string | null;
  gasUsedRatio: number;
  gasUsed: string | null;
  gasLimit: string | null;
}

/**
 * Grava blocos, ignorando os que já existem.
 *
 * A deduplicação é por `block_number` via NOT EXISTS, NÃO pela chave primária.
 * Motivo (bug encontrado em 29/08/2026): a PK é (momento, block_number), mas o
 * backfill grava momento INTERPOLADO e a ingestão ao vivo grava o momento REAL
 * do header. Para o mesmo bloco os dois diferem em alguns segundos, então o
 * ON CONFLICT não disparava e o bloco entrava DUAS vezes. A hypertable não
 * aceita índice único só em block_number (TimescaleDB exige a coluna de tempo
 * em qualquer índice único), daí o filtro ser explícito na query.
 *
 * Consequência: quem chegar primeiro no bloco vence. Na prática a ingestão ao
 * vivo é a autoridade na cabeça da cadeia e o backfill preenche o passado.
 *
 * Ressalva conhecida: se um reorg trocar o CONTEÚDO de um bloco mantendo o
 * número, a versão antiga permanece. Reorgs pós-merge são raros e rasos
 * (1-2 blocos); aceitável no MVP.
 */
export async function gravarBlocos(linhas: LinhaBloco[]): Promise<number> {
  if (linhas.length === 0) return 0;

  const valores: unknown[] = [];
  const tuplas = linhas.map((l, i) => {
    const b = i * 9;
    valores.push(l.momento, l.blockNumber, l.baseFeeWei, l.priorityFeeP25Wei,
                 l.priorityFeeP50Wei, l.priorityFeeP75Wei, l.gasUsedRatio,
                 l.gasUsed, l.gasLimit);
    return `($${b + 1}::timestamptz,$${b + 2}::bigint,$${b + 3}::bigint,$${b + 4}::bigint,` +
           `$${b + 5}::bigint,$${b + 6}::bigint,$${b + 7}::double precision,` +
           `$${b + 8}::bigint,$${b + 9}::bigint)`;
  });

  const res = await pool.query(
    `INSERT INTO bloco_gas (momento, block_number, base_fee_wei, priority_fee_p25_wei,
                            priority_fee_p50_wei, priority_fee_p75_wei, gas_used_ratio,
                            gas_used, gas_limit)
     SELECT v.momento, v.block_number, v.base_fee_wei, v.priority_fee_p25_wei,
            v.priority_fee_p50_wei, v.priority_fee_p75_wei, v.gas_used_ratio,
            v.gas_used, v.gas_limit
     FROM (VALUES ${tuplas.join(",")}) AS v(momento, block_number, base_fee_wei,
            priority_fee_p25_wei, priority_fee_p50_wei, priority_fee_p75_wei,
            gas_used_ratio, gas_used, gas_limit)
     WHERE NOT EXISTS (
       SELECT 1 FROM bloco_gas b WHERE b.block_number = v.block_number
     )
     ON CONFLICT (momento, block_number) DO NOTHING`,
    valores,
  );
  return res.rowCount ?? 0;
}

/** Maior bloco já gravado -- ponto de partida do backfill. */
export async function ultimoBlocoGravado(): Promise<number | null> {
  const r = await pool.query<{ n: string | null }>("SELECT max(block_number)::text AS n FROM bloco_gas");
  return r.rows[0]?.n ? Number(r.rows[0].n) : null;
}

/** Um ponto da série horária, no formato que o solver espera. */
export interface PontoHorario {
  momento: Date;
  precoGwei: number;
}

/**
 * Série horária contígua terminando na última hora COMPLETA.
 *
 * Três detalhes que a query resolve e que não são óbvios:
 *
 * 1. `date_trunc('hour', now())` como limite superior exclui a hora em curso.
 *    Sem isso o último ponto seria a média de uma hora pela metade -- mais
 *    ruidoso que os demais, bem no ponto onde o Holt-Winters mais pesa.
 *
 * 2. `serie_horaria()` já aplica gapfill com `interpolate()`, então buraco no
 *    MEIO da série vem preenchido. O que sobra NULL são só as bordas, antes do
 *    primeiro bloco e depois do último -- e é por isso que filtrar NULL aqui
 *    devolve um intervalo contíguo, não um queijo suíço.
 *
 * 3. As bordas saem do relógio do BANCO, não do Node. Os dois containers
 *    podem divergir alguns segundos, e o balde de 1h é sensível a isso.
 */
export async function serieHoraria(horas: number): Promise<PontoHorario[]> {
  const r = await pool.query<{ momento: Date; preco_gwei: number }>(
    `WITH bordas AS (
       SELECT date_trunc('hour', now()) AS fim,
              date_trunc('hour', now()) - ($1::int * INTERVAL '1 hour') AS inicio
     )
     SELECT s.momento, s.preco_gwei
     FROM bordas, serie_horaria(bordas.inicio, bordas.fim) s
     WHERE s.preco_gwei IS NOT NULL
     ORDER BY s.momento`,
    [horas],
  );
  return r.rows.map((l) => ({ momento: l.momento, precoGwei: Number(l.preco_gwei) }));
}
