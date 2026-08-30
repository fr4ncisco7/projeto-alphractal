#!/usr/bin/env bash
# Roda a suíte de testes do solver dentro de um container.
#
# Os testes precisam de scipy/statsmodels, que raramente estão instalados na
# máquina do dev -- e é dentro do container que o código roda de verdade, então
# é lá que faz sentido testar. A imagem de teste é separada da de produção:
# pytest e httpx não vão para a imagem que a Alphractal executa.
#
# Uso:  ./scripts/testar-solver.sh              (suíte inteira)
#       ./scripts/testar-solver.sh -k teto      (argumentos vão para o pytest)
set -euo pipefail

cd "$(dirname "$0")/.."

docker build -q -t solver-testes -f - apps/solver <<'DOCKERFILE'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
DOCKERFILE

# O código vem por bind mount, não por COPY: assim editar um teste não exige
# reconstruir a imagem. --user evita __pycache__ root-owned no diretório montado.
docker run --rm \
  -v "$PWD/apps/solver:/app" \
  -w /app \
  --user "$(id -u):$(id -g)" \
  -e PYTHONDONTWRITEBYTECODE=1 \
  solver-testes python -m pytest "$@"
