-- Schema do monitor de fees.
-- Convenção híbrida: termos do protocolo Ethereum em inglês (base_fee,
-- priority_fee, gas_used, block_number); o resto em português.
--
-- Granularidades conforme decisão 1 do registro-decisoes-tecnicas.md:
--   captura por bloco (~12s) -> agregação 1min -> agregação 1h

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- Captura bruta, um registro por bloco
-- ---------------------------------------------------------------------------
-- Valores em WEI (inteiro exato, como o RPC devolve). Conversão para gwei
-- acontece na leitura -- guardar em gwei introduziria arredondamento.
-- BIGINT comporta com folga: 1000 gwei = 1e12 wei, limite do tipo = 9.2e18.
CREATE TABLE bloco_gas (
    momento               TIMESTAMPTZ NOT NULL,
    block_number          BIGINT      NOT NULL,

    base_fee_wei          BIGINT      NOT NULL,

    -- eth_feeHistory devolve percentis de priority fee por bloco. O p50
    -- alimenta o preço efetivo; p25/p75 ficam guardados de graça e permitem
    -- estudar dispersão do tip depois.
    priority_fee_p25_wei  BIGINT,
    priority_fee_p50_wei  BIGINT      NOT NULL,
    priority_fee_p75_wei  BIGINT,

    -- Decisão 2: o custo que alimenta o otimizador é base fee + priority fee.
    preco_efetivo_wei     BIGINT GENERATED ALWAYS AS
                          (base_fee_wei + priority_fee_p50_wei) STORED,

    -- Sinal de congestionamento e insumo do índice engenheirado (§6 da
    -- arquitetura, fórmula ainda aberta).
    --
    -- gas_used_ratio (= gas_used/gas_limit) é o único disponível nos DOIS
    -- caminhos de ingestão: eth_feeHistory devolve só a razão, e é ele que o
    -- backfill precisa usar (1024 blocos por chamada; buscar header a header
    -- seriam ~200 mil chamadas para 4 semanas de histórico).
    gas_used_ratio        DOUBLE PRECISION NOT NULL,

    -- Preenchidos só pela ingestão ao vivo, que recebe o header completo via
    -- newHeads. NULL nas linhas vindas de backfill -- por isso nullable.
    gas_used              BIGINT,
    gas_limit             BIGINT,

    -- Hypertable exige a coluna de tempo em qualquer índice único, por isso a
    -- PK é composta. ATENÇÃO: ela NÃO garante um bloco único -- o backfill
    -- grava momento interpolado e a ingestão ao vivo grava o real, então o
    -- mesmo block_number com momentos diferentes passaria batido. A
    -- deduplicação por block_number é feita na query de inserção
    -- (ver gravarBlocos em apps/backend-node/src/db.ts).
    PRIMARY KEY (momento, block_number)
);

SELECT create_hypertable('bloco_gas', 'momento',
                         chunk_time_interval => INTERVAL '1 day');

CREATE INDEX ON bloco_gas (block_number DESC);

-- ---------------------------------------------------------------------------
-- Agregações contínuas
-- ---------------------------------------------------------------------------
-- Ambas são construídas direto sobre a hypertable, e NÃO em cascata
-- (1h sobre 1min). Motivo: mediana não é composável -- a mediana das medianas
-- de 60 baldes de 1min não é a mediana da hora. Média/min/max seriam
-- composáveis, mas manter as duas com a mesma fonte evita ter métricas com
-- semânticas diferentes na mesma linha.

CREATE MATERIALIZED VIEW gas_1min
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', momento)                                AS momento,
       avg(preco_efetivo_wei)                                          AS media_wei,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY preco_efetivo_wei)  AS mediana_wei,
       min(preco_efetivo_wei)                                          AS minimo_wei,
       max(preco_efetivo_wei)                                          AS maximo_wei,
       avg(base_fee_wei)                                               AS base_fee_media_wei,
       avg(gas_used_ratio)                                             AS gas_used_ratio_medio,
       count(*)                                                        AS blocos
FROM bloco_gas
GROUP BY 1
WITH NO DATA;

CREATE MATERIALIZED VIEW gas_1h
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', momento)                                  AS momento,
       avg(preco_efetivo_wei)                                          AS media_wei,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY preco_efetivo_wei)  AS mediana_wei,
       min(preco_efetivo_wei)                                          AS minimo_wei,
       max(preco_efetivo_wei)                                          AS maximo_wei,
       avg(base_fee_wei)                                               AS base_fee_media_wei,
       avg(gas_used_ratio)                                             AS gas_used_ratio_medio,
       count(*)                                                        AS blocos
FROM bloco_gas
GROUP BY 1
WITH NO DATA;

-- Refresh automático. end_offset deixa a janela mais recente de fora para não
-- materializar balde ainda incompleto.
SELECT add_continuous_aggregate_policy('gas_1min',
    start_offset      => INTERVAL '3 hours',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('gas_1h',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '10 minutes');

-- Agregação em tempo real: a consulta passa a unir o que já foi materializado
-- com os blocos crus do balde ainda aberto. Sem isto o gas_1min só devolve o
-- minuto anterior (o end_offset acima deixa o balde corrente de fora, e a
-- política só roda a cada 1 min) -- até ~2 min de atraso, inaceitável num
-- gráfico que se diz "tempo real". O custo é a consulta unir duas fontes;
-- irrelevante nas janelas curtas que o painel lê.
ALTER MATERIALIZED VIEW gas_1min SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW gas_1h   SET (timescaledb.materialized_only = false);

-- ---------------------------------------------------------------------------
-- Série horária para o estimador
-- ---------------------------------------------------------------------------
-- A decisão 8 exige uma série horária SEM BURACOS: `treinar()` em
-- estimador_custo.py recebe uma pandas.Series com DatetimeIndex contínuo, e o
-- Holt-Winters (sazonalidade 24h) quebra se faltar hora. Rede caindo, gap de
-- ingestão ou reorg produzem buraco -- time_bucket_gapfill + interpolate()
-- fecham isso na leitura, sem precisar gravar linha sintética no banco.
--
-- Buraco na borda inicial permanece NULL de propósito: interpolate() só
-- preenche ENTRE pontos conhecidos, nunca extrapola. Cabe a quem chama
-- decidir o recorte (mínimo recomendado: ~4 semanas / 672 pontos).
CREATE FUNCTION serie_horaria(inicio TIMESTAMPTZ, fim TIMESTAMPTZ)
RETURNS TABLE (momento TIMESTAMPTZ, preco_gwei DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.momento, s.preco_wei / 1e9
    FROM (
        SELECT time_bucket_gapfill('1 hour', b.momento)   AS momento,
               interpolate(avg(b.preco_efetivo_wei))      AS preco_wei
        FROM bloco_gas b
        WHERE b.momento >= inicio AND b.momento < fim
        GROUP BY 1
    ) s;
$$;
