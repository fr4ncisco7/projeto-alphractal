# Alphractal Fees Monitor

Monitoramento de gas da Ethereum em tempo real, com um **otimizador de execução**
que recomenda como distribuir N transações ao longo do tempo para minimizar o
custo total de gas.

Projeto do **Inteli Blockchain** em parceria com a **Alphractal** (Nortech Labs),
para a aba "Fees" da plataforma. Entrega open source (MIT).

> **Status:** MVP em construção. Ingestão, schema e solver funcionam de ponta a
> ponta; painel e índice engenheirado ainda não.

## O problema

A aba "Fees" da Alphractal hoje se apoia em médias históricas estáticas, o que
cria um ponto cego frente à volatilidade instantânea da mempool. Isso expõe
gestores de fundo a risco de execução: operações travadas por estimativa
imprecisa ou custo excessivo em picos não previstos.

A pergunta que o usuário institucional faz é *"executo agora ou espero?"* — e
essa é uma pergunta **prescritiva**, não descritiva. Daí o otimizador.

## Arquitetura

| Serviço | Stack | Papel |
|---|---|---|
| `backend-node` | Node + TypeScript + Express | ingestão via WebSocket, orquestra o solver |
| `solver-python` | Python + FastAPI | estima custo por janela e resolve o MILP |
| `db` | TimescaleDB (Postgres) | bruto por bloco + agregações 1min/1h |

O otimizador é um **MILP** (`scipy.optimize.milp`): a variável de decisão é o
número inteiro de transações por janela de 1h, porque gas é custo fixo por
transação, não proporcional ao volume movimentado.

## Como rodar

```bash
cp .env.example .env
docker compose up --build
```

| Serviço | Porta |
|---|---|
| backend-node | http://localhost:3000 |
| solver-python | http://localhost:8000 |
| db | localhost:5433 |

A ingestão ao vivo começa junto com o backend. Para popular histórico:

```bash
docker compose exec backend-node npm run backfill -- 24   # horas
```

> **Atenção — limite do provedor RPC.** O padrão é um endpoint público sem
> chave, que só entrega **~3,4h** de histórico retroativo; além disso o nó
> recusa como "requisição de arquivo". O otimizador exige no mínimo 48h. Para
> ir além, configure `RPC_HTTP_URL`/`RPC_WS_URL` com uma chave Alchemy ou
> Infura. A ingestão ao vivo acumula ~24h por dia de qualquer forma.

Alterar o schema exige recriar o volume, porque o Postgres só roda `db/init/`
com o volume vazio:

```bash
./scripts/reset-db.sh          # destrói o banco e reaplica o schema
```

Para desenvolver sem esperar dado real acumular, 5 semanas de dado sintético:

```bash
./scripts/semear.sh
```

O script pede confirmação se houver dado a perder e **desliga a ingestão ao vivo** antes
de semear — bloco real e bloco sintético na mesma tabela corrompem a série sem que nada
quebre visivelmente. Ver `docs/como-rodar.md` §6.

## API

```
GET  /health              estado do banco, da ingestão, do solver e nº de conexões SSE
GET  /gas/recente         série de 1 min para o gráfico ao vivo   ?minutos=180
GET  /gas/estatisticas    média, mediana e moda do dia (+ custo em USD)
GET  /cotacao             ETH/USD, com a fonte e o instante
GET  /gas/calendario      agregado horário para o heatmap         ?dias=7
GET  /stream              Server-Sent Events, um evento por bloco novo
POST /otimizar            plano de execução para N transações até um prazo
```

Todas as rotas respondem com CORS liberado (`*`), para o frontend em `localhost:5173`
poder chamar o backend em `localhost:3000` durante o desenvolvimento.

O `/stream` só emite com `INGESTAO_ATIVA=true` — sem ingestão não há bloco novo, e a
conexão fica aberta em silêncio. O primeiro comentário enviado avisa em qual modo está.

```bash
curl -X POST localhost:3000/otimizar -H 'Content-Type: application/json' \
  -d '{"n_transacoes":50,"horas_ate_deadline":24,"gas_used":21000}'
```

No lugar de `gas_used` é possível mandar `transacao: {"to":"0x..."}`, e o backend
estima via `eth_estimateGas`. A resposta traz o plano por janela, a economia contra
executar tudo agora, e o intervalo de histórico usado.

Responde **503** com um campo `como_resolver` quando não há 48h de histórico no
banco — que é o caso enquanto o RPC não tiver chave (ver aviso acima).

## Testes

O solver tem suíte versionada — 62 testes cobrindo o MILP (comparado com força
bruta), o estimador e o contrato HTTP. Roda dentro de um container, então não é
preciso ter Python nem scipy na máquina:

```bash
./scripts/testar-solver.sh              # suíte inteira, ~2s
./scripts/testar-solver.sh -k teto      # argumentos passam direto para o pytest
```

O backend Node ainda não tem testes, e nada roda automaticamente em push.

## Estrutura

```
apps/backend-node/   ingestão RPC (ao vivo + backfill), API
apps/solver/         estimador de custo + otimizador MILP (+ tests/)
db/init/             schema aplicado no boot do container
db/seed/             dado sintético para desenvolvimento
docs/                planejamento, arquitetura e registro de decisões
scripts/             utilitários de desenvolvimento
```

## Documentação

- [`docs/como-rodar.md`](docs/como-rodar.md) — **guia completo de execução**: o que cada
  serviço faz, como verificar, os dados, e os problemas conhecidos
- [`docs/estado-do-projeto.md`](docs/estado-do-projeto.md) — **o que está pronto, o que
  falta e como faremos**, com a stack de cada frente e os resultados medidos
- [`docs/planejamento-projeto.md`](docs/planejamento-projeto.md) — escopo, roadmap, riscos
- [`docs/arquitetura-tecnica.md`](docs/arquitetura-tecnica.md) — stack e diagramas de sequência
- [`docs/registro-decisoes-tecnicas.md`](docs/registro-decisoes-tecnicas.md) — **toda decisão
  técnica com motivo, evidência e fonte.** Consultar antes de alterar a formulação do
  otimizador ou do estimador — várias alternativas óbvias já foram testadas e descartadas
  por medição

## Licença

MIT — ver [LICENSE](LICENSE).
