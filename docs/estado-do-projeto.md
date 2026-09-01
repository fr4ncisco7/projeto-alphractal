<!-- docs/estado-do-projeto.md -->

# Estado do Projeto: Monitor de Fees + Otimizador de Execução

Este documento registra o que está construído e verificado, o que ainda falta, e
como pretendemos fazer o que falta.

Ele é organizado em cinco seções:

1. **Ingestão e persistência** — como o dado de gas entra e onde ele fica
2. **Solver de otimização** — a peça prescritiva, que responde "quando executar"
3. **Infraestrutura** — orquestração, estrutura de pastas e execução local
4. **O que falta** — com a stack proposta para cada frente
5. **Limitações conhecidas**

**Datas:** kickoff 14/09/2026, demo final 05/10/2026. Este documento reflete o
estado em 29/08/2026 — trabalho feito **antes** do kickoff oficial.

> **Fonte da verdade para decisões técnicas:** [`registro-decisoes-tecnicas.md`](registro-decisoes-tecnicas.md).
> Este documento descreve o *estado*; aquele registra *por que* cada escolha foi
> feita, com a evidência que a sustenta. Várias alternativas óbvias já foram
> testadas e descartadas por medição — consultar antes de "melhorar" o otimizador
> ou o estimador.

---

# 1. Ingestão e Persistência de Dados

## 1.1. Visão geral

A aba "Fees" da Alphractal hoje se apoia em médias históricas estáticas. Isso cria
um ponto cego frente à volatilidade instantânea da mempool: o gestor que decide com
base numa média de ontem não enxerga o pico que está acontecendo agora.

Capturar essa volatilidade exige granularidade de **bloco** (~12s). Uma amostragem
mais espaçada perderia exatamente o fenômeno que o projeto existe para medir. O
EIP-1559 limita a variação da base fee a 12,5% por bloco, mas isso não impede uma
mudança grande ao longo de vários blocos seguidos — há caso documentado de base fee
praticamente dobrando em três minutos.

O fluxo tem um sentido só, e entendê-lo explica o desenho:

```
RPC Ethereum -> backend-node -> normaliza -> TimescaleDB -> agrega -> solver / painel
```

O dado bruto é imutável e só cresce. As agregações são derivadas dele e podem ser
recalculadas a qualquer momento.

## 1.2. Stack tecnológica

**Ingestão**

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Linguagem | TypeScript, Node 20 | Definido no TAP; o ecossistema Ethereum em JS é maduro |
| Cliente Ethereum | viem 2.56 | Tipagem melhor que ethers v6; `watchBlocks` encapsula a assinatura WebSocket com recuperação de blocos perdidos |
| Driver do banco | pg 8.23 | Driver oficial; aceita `BIGINT` como string, o que evita perda de precisão |
| Servidor HTTP | Express 4.22 | Health check hoje; base para o SSE depois |
| Execução em dev | tsx | Recarrega ao salvar, sem passo de build |

**Persistência**

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Banco | TimescaleDB 2.29 sobre PostgreSQL 16 | Hypertable particiona por tempo automaticamente; *continuous aggregates* materializam os rollups sem job externo |
| Captura bruta | Hypertable `bloco_gas` | Um registro por bloco, particionado em chunks de 1 dia |
| Agregação intermediária | Continuous aggregate `gas_1min` | Camada de 1 minuto para o gráfico em tempo real |
| Agregação de análise | Continuous aggregate `gas_1h` | Janela de decisão do otimizador e visão de calendário |
| Série sem buracos | Função `serie_horaria()` | `time_bucket_gapfill` + `interpolate` na leitura |

## 1.3. Camadas de dados

Duas granularidades, para propósitos diferentes.

| Objeto | O que é | Para quê |
| --- | --- | --- |
| `bloco_gas` | hypertable, 1 registro por bloco | captura bruta; `preco_efetivo_wei` é coluna gerada (`base_fee + priority_fee_p50`) |
| `gas_1min` | continuous aggregate | média, mediana, mín, máx e congestão por minuto |
| `gas_1h` | continuous aggregate | mesmas métricas por hora |
| `serie_horaria(início, fim)` | função SQL | série horária contígua, entrada do estimador |

### Três decisões dentro do schema

**Valores em wei, como `BIGINT`.** Wei é o inteiro exato que o RPC devolve.
Converter para gwei na gravação introduziria arredondamento em todo registro. O tipo
tem ~6 ordens de grandeza de folga: 1000 gwei = 1×10¹² wei, e o limite é 9,2×10¹⁸.
A conversão acontece na leitura.

**As duas agregações saem direto da hypertable, não em cascata.** Seria mais barato
construir `gas_1h` sobre `gas_1min`, mas **mediana não é composável**: a mediana de
60 medianas de 1 minuto não é a mediana da hora. Média, mínimo e máximo seriam
composáveis — manter as duas com a mesma fonte evita ter métricas com semânticas
diferentes na mesma linha. A **moda** (pedido explícito do parceiro) fica em query,
não materializada: `mode()` sobre um dia varre ~7.200 linhas, o que é barato.

**O gapfill acontece na leitura, nunca na escrita.** A decisão 8 exige série horária
contígua, porque o Holt-Winters sazonal quebra se faltar hora — e queda de rede ou
reorg produzem buraco. `serie_horaria()` preenche com `time_bucket_gapfill` +
`interpolate()` no momento da consulta. O dado bruto continua sendo só o que foi de
fato observado: nunca gravamos linha sintética.

## 1.4. Os dois caminhos de ingestão

Um caminho só não resolve, porque as duas necessidades são diferentes: acompanhar a
cabeça da cadeia em tempo real, e recuperar semanas de passado.

| | Ao vivo (`ingestao.ts`) | Backfill (`backfill.ts`) |
| --- | --- | --- |
| Gatilho | assinatura `newHeads` via WebSocket | sob demanda: `npm run backfill -- <horas>` |
| Fonte | header do bloco + `eth_feeHistory` de 1 bloco | `eth_feeHistory` em lotes de 1024 |
| `momento` | timestamp real do header | interpolado entre âncoras reais |
| `gas_used` / `gas_limit` | preenchidos | **NULL** — `feeHistory` não os devolve |
| Congestão | calculada do header | `gasUsedRatio` direto do `feeHistory` |

O backfill existe porque o estimador precisa de ~4 semanas de histórico e a ingestão
ao vivo levaria 4 semanas para acumular isso. Ele usa `eth_feeHistory` em lote
porque buscar header a header seriam ~200 mil chamadas para 4 semanas, contra ~200.

Esse ganho tem um preço: `feeHistory` não devolve `gasUsed`/`gasLimit` (só a razão
entre eles) nem timestamps. Daí `gas_used_ratio` ser a coluna obrigatória — é a
única disponível nos dois caminhos — e `gas_used`/`gas_limit` serem opcionais.

### Timestamps do backfill

Como `feeHistory` não devolve timestamp, o `momento` de cada bloco é interpolado.
A primeira versão ancorava só nas pontas de cada lote de 1024 blocos. **Erro medido:
até 12 segundos** — um bloco inteiro, o bastante para jogar o registro no balde de
1 minuto errado. Pós-merge os slots são de 12s exatos, mas slot perdido (~0,5–1%)
faz o relógio real descolar da contagem de blocos.

Corrigido ancorando a cada **128 blocos** (~9 chamadas por lote em vez de 2). Erro
medido depois: **0,8s em média, 7s no pior caso**, com 9 de 12 blocos amostrados
exatos.

### A chave primária não deduplica bloco

A PK é `(momento, block_number)` porque a hypertable exige a coluna de tempo em
qualquer índice único — não é possível ter `UNIQUE(block_number)`. Mas o backfill
grava momento *interpolado* e a ingestão ao vivo grava o momento *real*: para o mesmo
bloco os dois diferem em segundos, o `ON CONFLICT` não dispara, e **o bloco entra
duas vezes**. Isso aconteceu de verdade — 8 blocos duplicados na sobreposição entre
os dois caminhos.

A deduplicação é feita por `NOT EXISTS` sobre `block_number` na query de inserção.
Quem chega primeiro no bloco vence: na prática a ingestão ao vivo é autoridade na
cabeça da cadeia, e o backfill preenche o passado.

## 1.5. Limite de histórico do provedor RPC

Este é o **bloqueio externo mais relevante do projeto** hoje.

O `RPC_HTTP_URL` padrão é um endpoint público sem chave. Medido em 29/08/2026:

| Requisição | Resultado |
| --- | --- |
| `eth_feeHistory`, 1024 blocos, a partir de `latest` | **funciona** — 3,4h de histórico |
| `eth_feeHistory` com número de bloco **explícito** | só até ~32 blocos da cabeça (~6 min) |
| Além disso | `Archive requests require a personal token` |

**Consequência:** no endpoint público o backfill trava em ~3,4 horas. O `/optimize`
exige no mínimo 48h de histórico, então **ele não roda com dado real até haver uma
chave Alchemy ou Infura**, ou até a ingestão ao vivo acumular sozinha (~24h por dia).

O backfill detecta a recusa, para limpo e informa quantas horas conseguiu — não
estoura.

## 1.6. O que foi verificado

Todos os números abaixo vieram de medição contra a mainnet ou contra o banco real.

| Verificação | Resultado |
| --- | --- |
| Ingestão ao vivo grava blocos reais | 903 blocos, preço efetivo médio **0,10 gwei** |
| Coerência com a literatura | bate com ~0,16 gwei registrado em abr/2026 (decisão 2) |
| Pico capturado | 10,05 gwei — a volatilidade que o projeto existe para monitorar |
| Intervalo entre blocos | média **12,04s**, sem valor negativo |
| Duplicatas de `block_number` | **0** |
| Erro de interpolação de timestamp | **0,8s** médio, 7s máximo |
| Agregações contínuas | `gas_1min` e `gas_1h` materializam e refrescam por política |
| `serie_horaria()` preenche buraco | testado com buraco proposital de 3h — preenchido por interpolação linear |

---

# 2. Solver de Otimização

## 2.1. Visão geral

Esta é a única peça **prescritiva** do projeto. Um gráfico de gas descreve o que
aconteceu; o otimizador responde à pergunta que o gestor institucional realmente
faz: *"executo agora ou espero?"*.

Dado um número de transações a executar até um deadline, ele recomenda quantas
executar em cada janela de 1 hora, minimizando o custo total de gas.

## 2.2. Stack tecnológica

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Linguagem | Python 3.11 | Ecossistema científico e de pesquisa operacional mais maduro |
| Framework | FastAPI 0.141 | Validação de contrato via Pydantic e OpenAPI automático |
| Solver | `scipy.optimize.milp` 1.17 (backend HiGHS) | Resolve MILP; mantém tudo no scipy sem adicionar PuLP ou OR-Tools |
| Estimativa sazonal | statsmodels 0.15 (`ExponentialSmoothing`) | Holt-Winters com parâmetros ajustados por máxima verossimilhança |
| Manipulação de série | pandas 3.0 / numpy 2.4 | Índice temporal, reamostragem diária, álgebra vetorial |
| Servidor | Uvicorn | ASGI padrão do FastAPI |
| Testes | pytest 8.4 + `TestClient` do FastAPI | 62 testes; fora da imagem de produção (`requirements-dev.txt`) |

## 2.3. Formulação do MILP

```
variável:    x_i = número INTEIRO de transações na janela i
objetivo:    minimizar  Σ x_i × GAS_USED × custo_i
restrições:  Σ x_i = N
             0 ≤ x_i ≤ teto,  teto = max(⌈0,3×N⌉, ⌈N/M⌉)
```

**Por que MILP e não LP contínuo.** Gas é custo fixo por transação (~21.000 para
transferência, ~150.000 para swap), independente do valor movimentado. Um investidor
que precisa mover volume alto faz isso via várias transações — o gas não "desconta"
por mover mais valor numa transação só. Logo a variável é **contagem de transações**,
que é inteira por natureza.

**Por que existe teto.** Sem ele, o MILP concentra tudo na janela de menor custo
*previsto* — ótimo se a previsão estiver certa, arriscado se não estiver.

**Por que o teto tem dois termos.** O primeiro (30% de N) é a proteção de risco
calibrada por Monte Carlo. O segundo (N/M) existe só para garantir viabilidade em
horizonte curto: com M=2 e N=20, um teto de 30% daria capacidade 12 < 20, e o solver
retornaria *infeasible*. Ele relaxa o teto apenas o mínimo necessário.

**O que deliberadamente não existe.** Não há restrição de mínimo por janela nem de
início forçado. Foi testado via Monte Carlo e **piorou** mediana (+0,45%) e pior caso
(+28,0%). O mecanismo: TWAP e *participation rate* em finanças tradicionais existem
para limitar *impacto de mercado* — a própria negociação move o preço. Aqui o preço
de gas é **exógeno**: a transação do usuário não o afeta. Forçar início cedo só
remove flexibilidade sem oferecer proteção em troca.

**Horizonte parcial é truncado para baixo.** Deadline de 5h30 vira 5 janelas.
Conservador de propósito: nunca recomendar execução após o prazo real do usuário.

## 2.4. Estimador de custo por janela

```
custo_i = fator_dia_da_semana(dia de i) × sazonalidade_hora(hora de i)
```

A ordem das etapas importa e foi **corrigida durante este trabalho**:

1. **Fator de dia da semana primeiro**, direto do dado bruto, a partir das médias
   diárias. Cada dia calendário contém as 24 horas, então a média diária já está
   livre da sazonalidade horária — a razão entre a média de um dia e a média global
   isola o efeito do dia sem contaminação. Usa **mediana** entre as semanas, porque
   gas tem cauda pesada e um pico de 15x num sábado não pode redefinir o fator de sábado.
2. A série é dividida por esse fator, ficando neutra quanto a dia da semana.
3. **Holt-Winters** (sazonalidade multiplicativa, período 24h) na série já ajustada.
4. Na previsão, as duas estimativas voltam a ser multiplicadas.

### Por que a ordem original não funcionava

A versão anterior ajustava o Holt-Winters primeiro e tirava o fator de dia do
**resíduo**. O nível do Holt-Winters é uma média móvel que persegue a observação —
com `alpha` ajustado entre 0,22 e 1,00 nos testes, ele absorvia a queda de fim de
semana *conforme ela acontecia*, e o resíduo voltava a ~1,0 em todo dia.

Em horizonte de 24h isso era inofensivo: o nível fica congelado no último ponto,
então o erro é *uniforme* nas 24 horas, e o MILP é invariante a escala. A partir de
48h o erro deixa de ser uniforme e o otimizador passava a **ignorar o fim de semana
inteiro** — justamente a janela mais barata.

| Horizonte | Perda vs. onisciente (antes) | Depois | Aloca no fim de semana |
| --- | --- | --- | --- |
| 24h | 0,01% | 0,59% | 70% → 100% |
| 48h | **50,9%** | **0,70%** | 0% → 100% |
| 72h | **51,0%** | **0,72%** | 0% → 100% |
| 96h | **51,5%** | **0,72%** | 0% → 100% |

*(O otimizador onisciente, com previsão perfeita, aloca 90–100% no fim de semana.)*

## 2.5. Contrato do endpoint

O `POST /optimize` faz **estimativa e otimização numa chamada só**.

O diagrama original da arquitetura punha o cálculo do custo no backend Node ("busca
custo estimado por janela (média móvel)"). Isso fazia sentido enquanto o estimador
era uma média móvel, calculável em SQL. Quando ele virou Holt-Winters via
`statsmodels`, virou Python-only — e o Node não executa statsmodels. Manter a
estimativa junto do MILP evita um serviço intermediário ou reimplementar o estimador
em JavaScript.

```
POST /optimize
{
  "historico": [{"momento": "2026-08-01T18:00:00+00:00", "gwei": 13.34}, ...],
  "n_transacoes": 40,
  "horas_ate_deadline": 24,
  "gas_used": 150000
}
->
{
  "plano": [{"janela": 6, "x": 12, "custo_i_gwei": 8.91, "custo_janela_gwei": ...}, ...],
  "custo_total_gwei": 53844918,
  "custo_baseline_t0_gwei": 77839304,
  "economia_pct": 30.83,
  "teto_por_janela": 12,
  "n_janelas": 24,
  "aviso": null
}
```

O `custo_baseline_t0_gwei` e o `economia_pct` comparam contra o baseline "executar
tudo de uma vez" — o comportamento mais realista de quem não pensa em timing. São
três linhas de código e já entregam o número de negócio que a apresentação precisa.

| Situação | Resposta |
| --- | --- |
| Buraco no histórico | `422` apontando o número de horas faltando |
| Histórico < 48h (2 ciclos sazonais) | `422` |
| Histórico < 672h (~4 semanas) | `200` com campo `aviso` preenchido |
| Horizonte trunca para 0 janelas | `422` sugerindo execução imediata |
| Timestamps duplicados | `422` |

## 2.6. O que foi verificado

| Verificação | Resultado |
| --- | --- |
| MILP contra **força bruta** (enumeração exaustiva) | ótimo global exato |
| Caso de inviabilidade (M=2, N=20) | teto=10, resolve, soma exatamente N |
| Latência do MILP isolado | **~3ms**, estável de N=10 a N=10.000 |
| Latência ponta a ponta via HTTP | 77–158ms (o custo é o Holt-Winters, não o solver) |
| Monte Carlo, 500 cenários | reproduz a decisão 6: teto 30% piora mediana +7,7% e derruba pior caso −66% |
| Backtest com holdout, 38 origens | captura **95,0%** do ganho teórico possível |
| Estimador vs. média histórica simples | ganha em **100%** das origens |
| Caminhos de erro do endpoint | 7 casos, todos com status e mensagem corretos |

Desde 30/08/2026 essas verificações deixaram de ser scripts avulsos e viraram suíte
versionada em `apps/solver/tests/` — 62 testes, rodados por `./scripts/testar-solver.sh`
em ~2s.

| Arquivo | Testes | Cobre |
| --- | --- | --- |
| `test_otimizador.py` | 26 | MILP contra força bruta (5 instâncias), restrições, fórmula do teto, baseline, 9 caminhos de erro |
| `test_estimador.py` | 15 | Recuperação do fator de dia, **regressão da decisão 17**, robustez a pico, previsão vs. média simples em 4 horizontes |
| `test_api.py` | 21 | Contrato da resposta, truncamento do horizonte, validação de histórico, aviso de histórico curto |

**A suíte foi validada por mutação.** Passar não prova nada; o que prova é falhar quando
o código quebra. Três defeitos foram injetados de propósito e todos foram pegos:

| Defeito injetado | Testes que quebraram |
| --- | --- |
| Inverter a ordem das etapas do estimador (o bug da decisão 17) | 9 |
| Trocar o teto de 30% por 100% (some a proteção de risco) | 7 |
| Truncar o horizonte para cima (recomendaria após o prazo) | 3 |

O teste de regressão da decisão 17 é o mais importante do repositório: ele reimplementa
a ordem antiga e exige que a atual seja ao menos 10× mais precisa. Na prática a margem
medida é de ~240× (erro de 0,32% contra 77,6%). Aquele bug custava ~51% de perda em
horizontes ≥48h **sem levantar erro nenhum** — o módulo rodava, só entregava número errado.

---

## 2.7. Integração com o backend Node

O `SOLVER_URL` estava no compose desde o esqueleto, mas nenhum arquivo em `src/` o
usava — o solver existia e ninguém o chamava. O `POST /otimizar` fecha isso.

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Transporte | `fetch` nativo do Node 20 | Sem dependência nova; `AbortSignal.timeout` cobre o solver travado |
| Leitura da série | `serie_horaria()` no Postgres | Gapfill e interpolação já resolvidos no banco (decisão 14) |
| `GAS_USED` | número pronto **ou** `eth_estimateGas` | Aceita quem já tem o valor e quem quer estimar pela transação |
| Validação | manual, sem biblioteca | 4 campos; zod seria dependência maior que o problema |

**Quem lê o banco é o Node.** O solver continua stateless e sem credencial de banco:
recebe a série no corpo do pedido. É o que permite os 62 testes rodarem sem subir
Postgres.

**Dois status para duas falhas diferentes.** Entrada malformada é 422; histórico
insuficiente no banco é 503 — não é erro de quem chamou, é estado do sistema, e é a
resposta que mais vai aparecer enquanto não houver chave de RPC. Por isso o corpo do
503 traz `como_resolver`, em vez de só constatar o problema.

```
POST /otimizar
{ "n_transacoes": 50, "horas_ate_deadline": 24, "gas_used": 21000 }
->
{ "plano": [...], "economia_pct": 28.16, "n_janelas": 24, "teto_por_janela": 15,
  "historico_horas": 672, "historico_de": "...", "historico_ate": "..." }
```

| Verificação ponta a ponta | Resultado |
| --- | --- |
| Caminho feliz, 5 semanas de seed | 672h contíguas, plano soma exatamente N, **90ms** |
| Buraco de 3h no seed | preenchido pelo gapfill; série volta contígua |
| Estimativa via `eth_estimateGas` | funciona contra a mainnet |
| Histórico insuficiente (3,4h reais) | 503 com `como_resolver` |
| Solver fora do ar | 503; o `/health` passa a marcar `solver: "inalcancavel"` |
| Entradas inválidas | 5 casos, todos 422 com mensagem específica |

---

# 3. Infraestrutura e Execução

## 3.1. Stack tecnológica

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Orquestração | docker compose | Três serviços com uma linha de comando; rede interna por nome de serviço |
| Imagem do backend | `node:20-alpine` | Imagem pequena; `npm install` numa camada anterior ao código, preservando cache |
| Imagem do solver | `python:3.11-slim` | `pip install` antes do código, pelo mesmo motivo (scipy e statsmodels demoram) |
| Imagem do banco | `timescale/timescaledb:latest-pg16` | Traz a extensão já instalada |
| Migração de schema | `/docker-entrypoint-initdb.d` | O Postgres roda `db/init/*.sql` no primeiro boot |
| Sincronia de subida | `healthcheck` + `depends_on: service_healthy` | O backend só sobe quando o banco aceita conexão |

### Duas escolhas de container que valem registro

**Os containers rodam com o UID do host** (`user: "${UID:-1000}:${GID:-1000}"`).
Sem isso eles rodam como root, e tudo que escrevem nos diretórios montados —
`__pycache__`, por exemplo — vira arquivo root na máquina do desenvolvedor, que não
consegue nem apagar sem `sudo`.

**O banco publica na porta 5433**, não 5432. A porta interna do container continua
5432, então o `DATABASE_URL` entre containers não muda; só o acesso a partir do host
é que usa 5433. Isso evita conflito com um PostgreSQL instalado nativamente.

## 3.2. Estrutura de pastas

```
projeto-alpha/
├── apps/
│   ├── backend-node/            # ingestão RPC e API
│   └── solver/                  # estimador e otimizador
├── db/
│   ├── init/                    # schema aplicado no boot do container
│   └── seed/                    # dado sintético para desenvolvimento
├── docs/                        # planejamento, arquitetura, decisões, este documento
├── scripts/                     # utilitários de desenvolvimento
└── docker-compose.yml
```

### apps/backend-node/

```
apps/backend-node/
├── src/
│   ├── config.ts                # variáveis de ambiente num só lugar
│   ├── db.ts                    # pool de conexão e gravação com deduplicação
│   ├── rpc.ts                   # cliente viem, feeHistory e interpolação de timestamp
│   ├── ingestao.ts              # assinatura newHeads (ao vivo)
│   ├── backfill.ts              # recuperação de histórico em lote (CLI)
│   ├── solver.ts                # cliente HTTP do serviço de solver
│   └── index.ts                 # Express: /health, /otimizar, bootstrap da ingestão
├── Dockerfile
├── package.json
└── tsconfig.json
```

### apps/solver/

```
apps/solver/
├── estimador_custo.py           # fator de dia da semana + Holt-Winters
├── otimizador.py                # o MILP puro, testável sem HTTP
├── main.py                      # app FastAPI, contratos Pydantic, /optimize
├── tests/
│   ├── conftest.py              # põe o diretório do solver no sys.path
│   ├── sintetico.py             # gerador de série compartilhado pelos testes
│   ├── test_otimizador.py       # MILP contra força bruta, teto, erros
│   ├── test_estimador.py        # inclui a regressão da decisão 17
│   └── test_api.py              # contrato HTTP e caminhos de 422
├── Dockerfile
├── pytest.ini
├── requirements.txt             # só o que a imagem de produção precisa
└── requirements-dev.txt         # pytest e httpx, fora da imagem
```

O `Dockerfile` copia com `COPY *.py ./`, não módulo a módulo. A versão anterior
listava os arquivos um a um e **esquecia o `otimizador.py`** — a imagem só subia
porque o bind mount de desenvolvimento repunha o arquivo por cima. Ver decisão 21.

O `otimizador.py` é deliberadamente **puro**: recebe arrays e devolve arrays, sem
saber que HTTP existe. Isso permite rodar Monte Carlo e backtest sobre ele
diretamente, sem subir servidor — foi assim que as verificações da seção 2.6 foram
feitas.

### db/ e scripts/

```
db/
├── init/01_schema.sql           # hypertable, agregações, serie_horaria()
└── seed/dados_sinteticos.sql    # 5 semanas sintéticas, NÃO roda sozinho

scripts/
├── reset-db.sh                  # destrói o volume e reaplica o schema
├── semear.sh                    # carrega o dado sintético, com as travas
└── testar-solver.sh             # roda os 62 testes num container
```

O seed fica **fora** de `init/` de propósito: `init/` roda automaticamente no boot, e
dado falso não pode entrar sem alguém pedir.

## 3.3. Como rodar

```bash
cp .env.example .env
docker compose up --build
```

Para rodar os testes do solver (não precisa de Python na máquina — tudo acontece
dentro de um container, que é onde o código roda de verdade):

```bash
./scripts/testar-solver.sh              # suíte inteira, ~2s
./scripts/testar-solver.sh -k teto      # argumentos passam direto para o pytest
```

| Serviço | Endereço |
| --- | --- |
| backend-node | <http://localhost:3000> |
| solver-python | <http://localhost:8000> |
| db | localhost:5433 |

A ingestão ao vivo começa junto com o backend. Para popular histórico:

```bash
docker compose exec backend-node npm run backfill -- 24   # horas
```

Alterar o schema exige recriar o volume, porque o Postgres só roda `db/init/` com o
volume vazio:

```bash
./scripts/reset-db.sh
```

Para desenvolver sem esperar dado real acumular:

```bash
docker compose exec -T db psql -U alphractal -d fees_monitor < db/seed/dados_sinteticos.sql
```

---

# 4. O Que Falta

Quatro frentes. As duas primeiras são o **piso mínimo** de entrega; as duas últimas
são o que transforma "fizemos um otimizador" em prova quantificada de valor.

## 4.1. Frontend do painel

**Status:** shell da plataforma integrado, com as três telas no domínio de gas, gráfico ao vivo (lightweight-charts) e heatmap do calendário (ECharts). Falta o índice engenheirado (seção 4.3).

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Build | Vite | Definido no TAP; gera estático, produção não executa Node |
| Biblioteca | React + TypeScript | Definido no TAP |
| Gráfico em tempo real | lightweight-charts (TradingView) | Renderização em canvas, feita para séries financeiras com streaming; atualiza sem re-renderizar tudo a cada tick |
| Calendário e agregados | Apache ECharts | Tem *calendar heatmap* nativo, pedido explícito do parceiro; lightweight-charts não cobre |
| Estado de servidor | a definir (TanStack Query é candidato) | Cache e estados de carregamento num só lugar |

**Telas mínimas:** gráfico contínuo de gas, calendário semanal por hora,
estatísticas do dia (média, mediana, moda — pedido explícito do parceiro), e o
formulário do otimizador com o plano recomendado.

**Dependência:** nenhuma. O `gas_1min` e o `gas_1h` já entregam o que o gráfico e o
calendário precisam. Pode começar imediatamente, em paralelo ao resto.

## 4.2. Entrega em tempo real (SSE)

**Status:** concluído. `GET /stream` no backend, `EventSource` no painel, alimentando o gráfico ao vivo sem recarregar.

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Transporte | Server-Sent Events, nativo no Express | Requisito do TAP; unidirecional servidor→cliente, que é exatamente o caso |
| Origem do evento | o mesmo `onBlock` da ingestão | O bloco já chega ali; basta publicar além de gravar |

**Por que SSE e não polling:** o painel precisa refletir a mempool no instante da
decisão. Polling a cada N segundos ou perde evento ou desperdiça requisição.

**Como faremos:** um endpoint `GET /stream` que mantém a conexão aberta e emite a
cada bloco gravado. O `iniciarIngestaoAoVivo` já tem o ponto de extensão natural —
onde hoje ele só chama `gravarBlocos`, passa a também publicar no barramento.

## 4.3. Índice engenheirado de gas

**Status:** fórmula **ainda não definida**. É matemática nova, a ser proposta e
validada — não há biblioteca para isso.

O parceiro pediu um análogo ao CVDD (*Cumulative Value-Days Destroyed*) que a
Alphractal usa para Bitcoin: uma fórmula de engenharia com fator de ajuste que
converte dado bruto numa métrica única de "saúde" da rede. **Não** é um modelo
estatístico preditivo — essa distinção veio de esclarecimento explícito do parceiro.

**O que já temos para alimentá-la:** `base_fee_wei`, `priority_fee_p25/p50/p75_wei`
e `gas_used_ratio` por bloco. A razão de congestionamento é provavelmente o insumo
central, por ser o análogo mais direto de "pressão da rede".

**Referências a estudar:** o artigo original do CVDD, o report da Alphractal sobre
CVDD otimizado, e o Difficulty per Issuance — todos listados no planejamento.

**Risco:** é a única entrega sem caminho técnico conhecido. Deve começar cedo.

## 4.4. Backtest histórico

**Status:** não iniciado. **Bloqueado** pela chave de RPC (seção 1.5).

| Componente | Escolha | Para quê |
| --- | --- | --- |
| Execução | script Python no container do solver | Reusa `otimizador.py` e `estimador_custo.py` direto, sem HTTP |
| Modo | job batch offline | Evita timeout de requisição longa; o painel só lê o resultado pronto |
| Saída | JSON ou tabela no banco | O dashboard lê sem recalcular nada |

**O que compara:** custo de executar tudo de uma vez em t=0 (baseline principal,
o comportamento mais realista de quem não pensa em timing) contra o custo seguindo a
recomendação do otimizador, sobre janelas históricas reais. TWAP entra como
comparação secundária.

**Por que importa:** é o que transforma "fizemos um MILP" num número concreto de
economia para o Demo Day. A infraestrutura já existe — o Monte Carlo e o backtest com
holdout da seção 2.6 são essencialmente o mesmo código rodando sobre dado sintético.
Trocar por dado real é a mudança.

## 4.5. Sequenciamento proposto

| Ordem | Frente | Por quê nessa posição |
| --- | --- | --- |
| 1 | **Obter chave Alchemy/Infura** | Bloqueia backfill e backtest; é ação externa, não de código |
| 2 | Frontend + SSE, em paralelo | Maior lacuna, sem dependência; duas pessoas podem tocar frentes distintas |
| 3 | Índice engenheirado | Único item sem caminho técnico conhecido — começar cedo para ter tempo de errar |
| 4 | Backtest | Depende da chave (1) e do solver, que já está pronto |

**Definição de pronto:**

- **Piso mínimo aceitável:** índice engenheirado + visualizações funcionando de ponta a ponta
- **Teto desejado:** piso + otimizador integrado ao painel + backtest com número quantificado

O otimizador dockerizado e funcional era meta de semana 2 do roadmap, e já está
pronto, testado e **integrado ao backend** — a frente matematicamente arriscada está
resolvida antes do kickoff. Na prática isso significa que o frontend tem um endpoint
real para consumir (`POST /otimizar`) desde já, sem esperar mais nada do lado do
solver.

---

# 5. Limitações Conhecidas

**Toda a validação do estimador e do otimizador é em dado sintético.** O desconto de
fim de semana injetado (~0,55–0,61) é provavelmente mais forte e mais limpo que o
real. Os 50% de perda evitada pela correção do estimador são **teto, não estimativa**.
Revalidar com dado real de gas continua pendente.

**O backfill trava em 3,4h sem chave de RPC.** Consequência direta: o `/optimize`
não roda com dado real até haver chave ou até a ingestão ao vivo acumular 48h.

**O teto de 30% por janela foi calibrado com parâmetros sintéticos**, derivados da
literatura de skewness e kurtose do gas, não do histórico real do time. Recalibrar
quando houver dado capturado.

**Reorg sobrescreve nada.** Se um reorg trocar o conteúdo de um bloco mantendo o
número, a versão antiga permanece. Reorgs pós-merge são raros e rasos (1–2 blocos);
aceitável no MVP, mas é uma decisão consciente e não um esquecimento.

**`GAS_USED` é único para todas as N transações.** Assume que todas são do mesmo tipo
de operação (todas swaps, por exemplo). Se o uso real do parceiro envolver tipos
diferentes, seria necessário um `GAS_USED_i` por transação. Vale confirmar com o
parceiro antes de assumir homogeneidade.

**O teto é restrição heurística, não otimização formal risco-retorno.** A literatura
de execução (Almgren-Chriss) usa um termo de variância explícito na função objetivo;
usamos uma restrição rígida como proxy mais simples. Válido para o MVP, evolutivo se
sobrar tempo.

**Câmbio ETH/USD tratado como constante** dentro do horizonte de decisão. Testado:
erro médio de +0,16%, P5–P95 entre −4,1% e +4,8%. Pequeno frente às variações de gas,
que são de centenas de por cento.

**Migração de schema é destrutiva.** O Postgres só roda `db/init/` com o volume
vazio, então alterar o schema exige `./scripts/reset-db.sh`, que apaga o banco.
Aceitável enquanto não houver dado que não dá para perder; trocar por migrations
versionadas (node-pg-migrate ou Alembic) quando houver.

**O backend Node não tem testes.** O solver tem suíte versionada (seção 2.6), o Node
não. A ingestão foi verificada por medição manual contra a mainnet — reprodutível
enquanto alguém lembrar de rodar, o que não é garantia.

**Sem CI.** Nenhuma verificação roda automaticamente em push ou PR. Os 62 testes do
solver só rodam se alguém executar o script. Com a suíte pronta, ligar um workflow que
chame `./scripts/testar-solver.sh` é trabalho de minutos — vale fazer antes do time
crescer.

**Os testes rodam sobre dado sintético**, pelo mesmo motivo da primeira limitação desta
lista. Eles travam regressões da lógica, não validam que o modelo descreve o gas real.
