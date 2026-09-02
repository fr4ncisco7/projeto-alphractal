#!/usr/bin/env bash
# Roda o backtest do otimizador dentro do container de testes.
#
# Mesma imagem da suíte (scipy/statsmodels raramente estão na máquina do dev).
# O corpus é o CSV versionado em apps/solver/tests/dados/ -- o backtest não fala
# com o banco, para ser reproduzível e poder rodar em CI.
#
# Uso:  ./scripts/backtest.sh
#       ./scripts/backtest.sh --horizontes 6 12 --enes 50
set -euo pipefail

cd "$(dirname "$0")/.."

docker build -q -t solver-testes -f - apps/solver <<'DOCKERFILE'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
DOCKERFILE

docker run --rm \
  -v "$PWD/apps/solver:/app" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  solver-testes \
  python backtest.py "$@"
