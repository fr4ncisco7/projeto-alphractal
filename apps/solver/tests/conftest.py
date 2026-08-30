"""Poe o diretorio do solver no sys.path.

Os modulos sao top-level (`from otimizador import ...`) porque e' assim que o
container os enxerta em /app. Os testes rodam de fora, entao precisam do mesmo
caminho para importar igual.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
