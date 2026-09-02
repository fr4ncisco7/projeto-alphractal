#!/usr/bin/env bash
# Roda a suíte do backend Node.
#
# Sem argumentos: só os testes que não precisam de infraestrutura (barramento
# de eventos, cotação com fetch simulado, camada HTTP com banco e solver
# substituídos). Rodam em qualquer máquina e em CI, em menos de um segundo.
#
# Com --db: inclui os testes de integração. A DATABASE_URL do `.env` aponta para
# o host `db`, que só resolve dentro da rede do compose; da máquina hospedeira o
# endereço é outro, e a porta publicada NÃO é necessariamente 5432 -- neste
# projeto o compose mapeia para 5433, porque 5432 já estava ocupada por um
# Postgres da máquina. Chutar 5432 fazia os testes baterem no banco errado e
# falharem com "password authentication failed", que parece credencial errada e
# não é. A porta é perguntada ao compose. Exige a stack de pé.
#
# Uso:  ./scripts/testar-backend.sh
#       ./scripts/testar-backend.sh --db
#       ./scripts/testar-backend.sh -t "trava de defasagem"
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${1:-}" = "--db" ]; then
  shift
  [ -f .env ] || { echo "erro: .env não encontrado (cp .env.example .env)"; exit 1; }
  url="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
  [ -n "$url" ] || { echo "erro: DATABASE_URL ausente no .env"; exit 1; }

  publicado="$(docker compose port db 5432 2>/dev/null || true)"
  [ -n "$publicado" ] || { echo "erro: serviço db não está de pé (docker compose up -d)"; exit 1; }
  porta="${publicado##*:}"

  url="$(printf '%s' "$url" | sed "s|@db:5432/|@localhost:${porta}/|")"
  echo "[testes] banco em localhost:${porta}"
  cd apps/backend-node
  TEST_DB=1 DATABASE_URL="$url" npm test -- "$@"
else
  cd apps/backend-node
  npm test -- "$@"
fi
