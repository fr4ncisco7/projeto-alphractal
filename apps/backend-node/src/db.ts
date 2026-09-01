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

// ---------------------------------------------------------------------------
// Leituras do painel
// ---------------------------------------------------------------------------
// Todas devolvem gwei, não wei: wei é a unidade do protocolo e cabe no schema,
// mas o painel exibe gwei e converter aqui evita repetir a divisão em cada tela.
// A conversão é feita em SQL para o número já chegar pronto no JSON.

export interface PontoSerie {
  momento: Date;
  media_gwei: number;
  mediana_gwei: number;
  minimo_gwei: number;
  maximo_gwei: number;
  base_fee_media_gwei: number;
  gas_used_ratio_medio: number;
  blocos: number;
}

/**
 * Série de 1 minuto para o gráfico em tempo real.
 *
 * Lê de `gas_1min`, que agora roda com agregação em tempo real
 * (materialized_only = false): a consulta une o que já foi materializado com os
 * blocos do minuto ainda aberto. Sem isso o último ponto ficaria até ~2 min
 * atrasado, porque a política de refresh deixa o balde corrente de fora.
 */
export async function serieRecente(minutos: number): Promise<PontoSerie[]> {
  const r = await pool.query(
    `SELECT momento,
            (media_wei / 1e9)::double precision            AS media_gwei,
            (mediana_wei / 1e9)::double precision          AS mediana_gwei,
            (minimo_wei / 1e9)::double precision           AS minimo_gwei,
            (maximo_wei / 1e9)::double precision           AS maximo_gwei,
            (base_fee_media_wei / 1e9)::double precision   AS base_fee_media_gwei,
            gas_used_ratio_medio,
            blocos
     FROM gas_1min
     WHERE momento >= now() - ($1::int * INTERVAL '1 minute')
     ORDER BY momento`,
    [minutos],
  );
  return r.rows.map(normalizarPonto);
}

/** Agregado horário para o calendário/heatmap. */
export async function serieHorariaBruta(dias: number): Promise<PontoSerie[]> {
  const r = await pool.query(
    `SELECT momento,
            (media_wei / 1e9)::double precision            AS media_gwei,
            (mediana_wei / 1e9)::double precision          AS mediana_gwei,
            (minimo_wei / 1e9)::double precision           AS minimo_gwei,
            (maximo_wei / 1e9)::double precision           AS maximo_gwei,
            (base_fee_media_wei / 1e9)::double precision   AS base_fee_media_gwei,
            gas_used_ratio_medio,
            blocos
     FROM gas_1h
     WHERE momento >= date_trunc('day', now()) - ($1::int * INTERVAL '1 day')
     ORDER BY momento`,
    [dias],
  );
  return r.rows.map(normalizarPonto);
}

function normalizarPonto(l: Record<string, unknown>): PontoSerie {
  return {
    momento: l.momento as Date,
    media_gwei: Number(l.media_gwei),
    mediana_gwei: Number(l.mediana_gwei),
    minimo_gwei: Number(l.minimo_gwei),
    maximo_gwei: Number(l.maximo_gwei),
    base_fee_media_gwei: Number(l.base_fee_media_gwei),
    gas_used_ratio_medio: Number(l.gas_used_ratio_medio),
    blocos: Number(l.blocos),
  };
}

export interface EstatisticasDia {
  desde: Date;
  blocos: number;
  media_gwei: number | null;
  mediana_gwei: number | null;
  moda_gwei: number | null;
  minimo_gwei: number | null;
  maximo_gwei: number | null;
  congestionamento_medio: number | null;
}

/**
 * Média, mediana e moda do dia corrente -- as três pedidas explicitamente pelo
 * parceiro.
 *
 * A moda merece explicação: preço de gas é contínuo, e a moda de uma variável
 * contínua não existe de forma útil (praticamente todo bloco tem um valor
 * distinto, então "o mais frequente" seria qualquer um deles). O que a pergunta
 * quer dizer é a FAIXA de preço mais recorrente do dia, e para isso é preciso
 * agrupar em baldes.
 *
 * O balde é ADAPTATIVO -- 40 divisões entre o mínimo e o máximo do dia -- e não
 * de tamanho fixo. Um balde fixo de 0,1 gwei parecia razoável e estava errado:
 * com a mainnet perto de 0,06 gwei todos os blocos caem no mesmo balde, e a
 * moda saía 0,1, um valor MAIOR que o máximo observado (0,089). O mesmo balde
 * fixo seria fino demais numa época de gas a 80 gwei. Dividir a faixa observada
 * resolve os dois casos sem sintonizar constante nenhuma.
 *
 * Devolve o CENTRO do balde mais populoso. Empate é desfeito pelo balde mais
 * baixo, para a resposta ser determinística.
 */
export async function estatisticasDoDia(): Promise<EstatisticasDia> {
  const r = await pool.query(
    `WITH doDia AS (
       SELECT preco_efetivo_wei, gas_used_ratio
       FROM bloco_gas
       WHERE momento >= date_trunc('day', now())
     ),
     faixa AS (
       SELECT min(preco_efetivo_wei) AS piso,
              max(preco_efetivo_wei) AS teto,
              count(*)               AS n
       FROM doDia
     ),
     -- width_bucket distribui os valores em 40 faixas iguais entre piso e teto.
     -- Quando piso = teto (um bloco só, ou todos idênticos) a largura seria
     -- zero e a função erraria, então esse caso sai pelo COALESCE lá embaixo.
     baldes AS (
       SELECT width_bucket(d.preco_efetivo_wei, f.piso, f.teto, 40) AS balde,
              count(*)                                             AS n,
              f.piso, f.teto
       FROM doDia d, faixa f
       WHERE f.teto > f.piso
       GROUP BY 1, f.piso, f.teto
     ),
     moda AS (
       SELECT ((piso + (teto - piso) * (balde - 0.5) / 40.0) / 1e9) AS centro_gwei
       FROM baldes ORDER BY n DESC, balde ASC LIMIT 1
     )
     SELECT date_trunc('day', now())                                    AS desde,
            (SELECT count(*) FROM doDia)                                AS blocos,
            (SELECT avg(preco_efetivo_wei) / 1e9 FROM doDia)            AS media_gwei,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY preco_efetivo_wei) / 1e9
               FROM doDia)                                              AS mediana_gwei,
            -- Sem faixa (piso = teto) a moda é o próprio valor observado.
            COALESCE((SELECT centro_gwei FROM moda),
                     (SELECT min(preco_efetivo_wei) / 1e9 FROM doDia)) AS moda_gwei,
            (SELECT min(preco_efetivo_wei) / 1e9 FROM doDia)            AS minimo_gwei,
            (SELECT max(preco_efetivo_wei) / 1e9 FROM doDia)            AS maximo_gwei,
            (SELECT avg(gas_used_ratio) FROM doDia)                     AS congestionamento_medio`,
  );
  const l = r.rows[0];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    desde: l.desde,
    blocos: Number(l.blocos),
    media_gwei: num(l.media_gwei),
    mediana_gwei: num(l.mediana_gwei),
    moda_gwei: num(l.moda_gwei),
    minimo_gwei: num(l.minimo_gwei),
    maximo_gwei: num(l.maximo_gwei),
    congestionamento_medio: num(l.congestionamento_medio),
  };
}
