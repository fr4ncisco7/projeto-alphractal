#!/usr/bin/env bash
# Carrega o dado sintético de desenvolvimento, com as travas que o SQL sozinho
# não tem como aplicar.
#
# Duas coisas que dão errado ao rodar o .sql na mão, e que este script evita:
#
#   1. O seed começa com TRUNCATE. Se houver dado real capturado, ele some -- e
#      dado real de gas é irrecuperável, porque o RPC público só devolve as
#      últimas ~3,4h. Aqui o script conta o que existe e pede confirmação.
#
#   2. A ingestão ao vivo continua gravando durante e depois do seed. Bloco real
#      (~1,3 gwei) e bloco sintético (~12 gwei) se intercalam na hora corrente, e
#      o balde mais recente -- justamente o que mais pesa no Holt-Winters -- vira
#      uma média sem sentido. Nada quebra, nada avisa: o /otimizar segue
#      respondendo 200 com um plano baseado em série corrompida. Este script
#      desliga a ingestão antes de semear.
set -euo pipefail

cd "$(dirname "$0")/.."

psql_() {
  docker compose exec -T db psql -U "${POSTGRES_USER:-alphractal}" \
    -d "${POSTGRES_DB:-fees_monitor}" "$@"
}

# Consulta de leitura, com stdin fechado. O `docker compose exec` CONSOME o
# stdin mesmo com -T e mesmo quando o psql não precisa dele -- sem o </dev/null
# as consultas abaixo engolem a resposta destinada ao `read` da confirmação, e o
# script aborta sozinho sem explicar por quê.
consulta() {
  psql_ -tAc "$1" </dev/null | tr -d '[:space:]'
}

if ! docker compose ps --status running --services 2>/dev/null | grep -q '^db$'; then
  echo "O banco não está de pé. Rode 'docker compose up -d' antes." >&2
  exit 1
fi

existentes=$(consulta "SELECT count(*) FROM bloco_gas;")
reais=$(consulta "SELECT count(*) FROM bloco_gas WHERE block_number > 25000000;")

if [ "$existentes" != "0" ]; then
  echo "O banco já tem $existentes bloco(s), sendo $reais com número de bloco real."
  echo "O seed APAGA tudo isso (TRUNCATE), e dado real capturado não volta."
  if [ "$reais" != "0" ]; then
    echo
    echo "Para salvar antes, em outro terminal:"
    echo "  docker compose exec -T db psql -U alphractal -d fees_monitor \\"
    echo "    -c \"\\copy (SELECT momento, block_number, base_fee_wei, priority_fee_p25_wei,"
    echo "        priority_fee_p50_wei, priority_fee_p75_wei, gas_used_ratio, gas_used,"
    echo "        gas_limit FROM bloco_gas ORDER BY momento) TO STDOUT WITH CSV\" > backup.csv"
  fi
  echo
  read -rp "Continuar e apagar? [s/N] " resposta
  [[ "$resposta" == "s" || "$resposta" == "S" ]] || { echo "Abortado."; exit 1; }
fi

echo "Desligando a ingestão ao vivo (senão bloco real se mistura ao sintético)..."
INGESTAO_ATIVA=false docker compose up -d backend-node >/dev/null 2>&1 </dev/null

echo "Semeando 5 semanas de dado sintético..."
psql_ -q < db/seed/dados_sinteticos.sql

total=$(consulta "SELECT count(*) FROM bloco_gas;")
horas=$(consulta "SELECT count(*) FROM serie_horaria(now() - interval '672 hours', date_trunc('hour', now())) WHERE preco_gwei IS NOT NULL;")

echo
echo "Pronto: $total blocos, $horas horas de série contígua."
echo "A ingestão ao vivo ficou DESLIGADA de propósito."
echo "Para voltar a coletar dado real, comece de um banco limpo:"
echo "  ./scripts/reset-db.sh  &&  docker compose up -d"
