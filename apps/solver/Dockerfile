FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copia todo o pacote. Listar os modulos um a um ja' custou caro: o otimizador.py
# ficou de fora e a imagem so' subia porque o bind mount de dev tapava o buraco.
COPY *.py ./

EXPOSE 8000

# Sem --reload: isto e' o comando de producao. O compose sobrescreve com
# --reload para desenvolvimento.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
