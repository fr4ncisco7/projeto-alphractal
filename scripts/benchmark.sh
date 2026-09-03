#!/usr/bin/env bash
# Benchmark do otimizador: com solver contra sem solver, sobre o corpus real.
# Mesma imagem de teste do solver; o corpus é o CSV versionado, não o banco.
#
# Uso:  ./scripts/benchmark.sh
#       ./scripts/benchmark.sh --json benchmark.json --enes 50 200
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
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  solver-testes python benchmark.py "$@"
