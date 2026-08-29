#!/usr/bin/env bash
# Recria o banco do zero, reaplicando db/init/*.sql.
#
# Necessário porque o entrypoint do Postgres só roda os scripts de init quando
# o volume está vazio -- alterar o schema exige destruir o volume. Enquanto não
# houver dado que não dá para perder, isso é aceitável; quando houver, trocar
# por migrations versionadas (node-pg-migrate / Alembic).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Isto APAGA todo o dado do banco (volume db-data)."
read -rp "Continuar? [s/N] " resposta
[[ "$resposta" == "s" || "$resposta" == "S" ]] || { echo "Abortado."; exit 1; }

docker compose down -v
docker compose up -d db

echo -n "Aguardando o banco ficar saudável"
until [ "$(docker compose ps -q db | xargs docker inspect -f '{{.State.Health.Status}}')" = "healthy" ]; do
  echo -n "."; sleep 1
done
echo " pronto."

docker compose exec -T db psql -U "${POSTGRES_USER:-alphractal}" -d "${POSTGRES_DB:-fees_monitor}" \
  -c "\dt" -c "\dm"
