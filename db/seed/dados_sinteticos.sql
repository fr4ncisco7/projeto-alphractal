-- Dado SINTÉTICO para desenvolvimento -- NÃO é dado real de gas.
-- Fica fora de db/init/ de propósito: não roda sozinho no boot.
--
-- Uso:
--   docker compose exec -T db psql -U alphractal -d fees_monitor \
--     < db/seed/dados_sinteticos.sql
--
-- Gera 5 semanas de blocos a cada 12s com sazonalidade hora-do-dia (pico às
-- 14h) e desconto de fim de semana (0,55), mais um buraco proposital de 3h
-- para exercitar o gapfill de serie_horaria().

TRUNCATE bloco_gas;

INSERT INTO bloco_gas (momento, block_number, base_fee_wei, priority_fee_p25_wei,
                       priority_fee_p50_wei, priority_fee_p75_wei, gas_used_ratio,
                       gas_used, gas_limit)
SELECT ts,
       23000000 + n,
       (15e9 * (1 + 0.8*exp(-0.5*(power((extract(hour from ts)-14)/4.0,2))))
             * (CASE WHEN extract(isodow from ts) >= 6 THEN 0.55 ELSE 1.0 END)
             * (0.85 + random()*0.3))::bigint,
       (0.5e9)::bigint,
       (1e9 * (0.8 + random()*0.4))::bigint,
       (2e9)::bigint,
       0.5 + random()*0.5,
       (60000000 * (0.5 + random()*0.5))::bigint,
       60000000
FROM generate_series(now() - interval '35 days', now(), interval '12 seconds')
     WITH ORDINALITY AS g(ts, n)
WHERE NOT (ts >= now() - interval '10 days'
       AND ts <  now() - interval '10 days' + interval '3 hours');

CALL refresh_continuous_aggregate('gas_1min', NULL, NULL);
CALL refresh_continuous_aggregate('gas_1h',   NULL, NULL);
