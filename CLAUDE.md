# Alphractal Fees Monitor — Contexto do Projeto

Projeto do Inteli Blockchain em parceria com a Alphractal (Nortech Labs). Módulo de
monitoramento de gas em tempo real + otimizador de execução, para a aba "Fees" da
plataforma. Kickoff 14/09/2026, demo final 05/10/2026 (prazo de 4 semanas).

## Documentos de referência

Não estão importados aqui de propósito (são longos) — leia sob demanda quando a tarefa tocar o assunto:

- `docs/planejamento-projeto.md` — roadmap completo, cronograma semana a semana
- `docs/arquitetura-tecnica.md` — stack, diagramas de sequência dos 3 fluxos (ingestão, otimizador, backtest)
- `docs/registro-decisoes-tecnicas.md` — **toda decisão técnica com motivo e fonte** —
  consultar antes de alterar qualquer coisa da formulação do otimizador ou do estimador

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Node.js + TypeScript — ingestão via WebSocket (RPC Alchemy/Infura), entrega ao painel via SSE
- Solver: Python + FastAPI — endpoint `POST /optimize`, containerizado (Docker), chamado via HTTP síncrono pelo backend Node
- Orquestração: docker-compose
- Gráficos: lightweight-charts (tempo real) + Apache ECharts (calendário/heatmap)
- Dados: captura por bloco (~12s) + agregação em 1min e 1h

## Formulação do otimizador (fechada e testada — não reabrir sem motivo novo)

- **MILP**, não LP contínuo: `x_i` = número inteiro de transações na janela `i`
- Objetivo: `minimizar Σ x_i × GAS_USED × custo_i`
- Restrições: `Σ x_i = N`; `0 ≤ x_i ≤ teto`, onde `teto = max(⌈0,1×N⌉, ⌈N/M⌉)` (M = nº de janelas do horizonte — o segundo termo garante viabilidade em deadlines curtos)
- **A fração era 0,3 e virou 0,1** em 02/09/2026, recalibrada pelo backtest sobre mainnet: com 30% a economia agregada era −32,9% em 24h (o otimizador saía mais caro que não usá-lo); com 10% ficou +1,9% em 12h e −0,7% em 24h. Ver decisão 34
- **Trava de dominância:** se o plano distribuído custar mais que executar tudo agora, o solver devolve o baseline. `economia_pct` nunca é negativa (decisão 31)
- **Sem** restrição de mínimo/início forçado — testado via Monte Carlo e descartado (piorava o resultado; ver decisão 7 no registro)
- Câmbio ETH/USD tratado como constante dentro do horizonte de decisão — testado, erro pequeno (ver decisão 4)
- Solver: `scipy.optimize.milp` (não `linprog`, não PuLP/OR-Tools)
- GAS_USED vem de `eth_estimateGas`, calculado uma vez por pedido (não varia por janela)

## Estimador de custo_i (fechado e testado)

```
custo_i = nível_e_sazonalidade_hora(hora de i) × fator_dia_da_semana(dia de i)
```

- Etapa 1: **fator de dia da semana primeiro**, a partir das médias diárias (mediana entre as
  semanas). A média de um dia calendário contém as 24h, então já está livre da sazonalidade horária
- Etapa 2: série dividida por esse fator, e então Holt-Winters via `statsmodels` (sem tendência,
  sazonalidade multiplicativa, período=24h) para a hora do dia
- **Não inverter essa ordem** — tirar o fator de dia do resíduo do Holt-Winters foi testado e
  falhou: o nível (alpha) absorve a queda de fim de semana antes dela chegar ao resíduo. Custava
  ~51% de perda em horizontes ≥48h (ver decisão 17)
- **Não usar** um único modelo de 168 posições (hora×dia combinados) — testado e falhou (poucos dados por slot, pior que média simples; ver decisão 8)
- Módulo já implementado: `apps/solver/estimador_custo.py` (funções `treinar` e `prever`) — usar como base, não reescrever do zero

## Convenções

- **Nomenclatura híbrida:** termos do protocolo Ethereum em inglês (`base_fee`, `priority_fee`,
  `gas_used`, `gas_limit`, `block_number`) — são os nomes oficiais; o resto em português
  (`momento`, `media`, `mediana`, `preco_efetivo`, `bloco_gas`). Vale para schema, código e API.
- **Commits:** Conventional Commits em português, uma linha, sem corpo
  (`feat: adiciona estimador de custo`).

<!-- preencher conforme o time for definindo: lint, testes, branch strategy -->

## Layout

```
apps/backend-node/   Express + TS — ingestão, SSE, orquestra o solver
apps/solver/         FastAPI — estimador_custo.py + otimizador.py, endpoint /optimize
db/init/             schema aplicado no boot do container (só com volume vazio)
db/seed/             dado sintético para dev — NÃO roda sozinho
scripts/reset-db.sh  recria o banco do zero (destrói o volume)
```

Alterar schema exige `./scripts/reset-db.sh` — o entrypoint do Postgres só roda `db/init/`
quando o volume está vazio. Trocar por migrations versionadas quando houver dado real.
