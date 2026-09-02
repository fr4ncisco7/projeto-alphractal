# Registro de Decisões Técnicas — Otimizador de Execução & Pipeline de Dados

> Documento vivo. Cada entrada registra o que foi decidido, por quê, e as fontes que embasaram a escolha (quando aplicável). Atualizar conforme o projeto avança — decisões em aberto ficam marcadas como tal.

**Última atualização:** 29/08/2026

---

## 1. Granularidade de dados: captura por bloco, agregação em 1min e 1h

**Decisão:** Capturar gas a nível de bloco (~12s) e agregar em duas camadas — 1 minuto (intermediária) e 1 hora (usada pelo otimizador e pela visão de calendário).

**Motivo:** A volatilidade instantânea da mempool — o problema central relatado pelo parceiro — só é capturável em granularidade de bloco. Agregações maiores (1h) já são suficientes para decisões de execução, que não fazem sentido em escala de segundos.

**Evidência de suporte:** O EIP-1559 limita a mudança da base fee a no máximo 12,5% por bloco — mas isso não impede uma mudança grande ao longo de vários blocos seguidos. Um exemplo documentado mostra a base fee praticamente dobrando em cerca de três minutos durante um pico de demanda, levando cerca de uma hora para voltar ao patamar normal depois que o pico passa. Isso confirma que uma janela de 1h pode conter variação substancial de custo no meio do caminho.

**Fontes:**
- EIP-1559 — especificação oficial ([ethereum/EIPs](https://eips.ethereum.org/EIPS/eip-1559))
- "EIP-1559 Explained: Fee Market Reform" — [Eco](https://eco.com/support/en/articles/14796247-eip-1559-explained-fee-market-reform) (2026)

---

## 2. Composição do gas: base fee + priority fee (e o que fica de fora do escopo)

**Decisão:** o "custo" que alimenta o otimizador é o **preço efetivo de gas = base fee + priority fee** (o que o usuário de fato paga). Essa é a grandeza que a camada de ingestão captura por bloco.

**Componentes identificados:**
- **Base fee:** obrigatória, definida algoritmicamente pelo protocolo, queimada (burned)
- **Priority fee (tip):** opcional, paga ao validador, incentiva inclusão mais rápida
- **Max fee:** teto definido pelo usuário; a diferença entre max fee e (base+priority) é reembolsada automaticamente — não é custo real, é mecanismo de segurança
- **Total Gas Fee = Gas Used × (Base Fee + Priority Fee)**

**Explicitamente fora do escopo do MVP (documentado, não modelado):**
- **Blob fee (EIP-4844/Dencun):** mercado de taxa separado, usado por L2s para postar dados no L1 — não afeta transações L1 comuns, relevante só se o projeto expandir para L2 no futuro
- **Custo implícito de MEV** (reordenamento de transações): existe literatura quantificando um "preço-sombra" real de prioridade temporal, mas modelar isso é significativamente mais complexo — fica como limitação conhecida, não implementada
- **Refunds de gas:** praticamente eliminados pelo EIP-3529, não há reembolso relevante a considerar

**Fontes:**
- Dwellir — ["Ethereum Gas Fees Explained"](https://www.dwellir.com/blog/ethereum-gas-fees-explained) (abril 2026)
- DEXTools — ["What Is Gas Price (Gwei): Complete Ethereum Fees Guide 2026"](https://www.dextools.io/tutorials/what-is-gas-price-gwei-ethereum-fees-guide-2026)
- Spydra — ["Ethereum Gas Fees Explained: The Complete 2026 Guide"](https://www.spydra.app/blog/ethereum-gas)
- CoinLaw — ["Ethereum Gas Fee History"](https://coinlaw.io/ethereum-gas-fee-history/) (abril 2026) — gas em ~0,16 gwei em abril/2026

---

## 3. Correção fundamental: custo é por transação (fixo), não proporcional a volume

**Decisão:** a variável de decisão do otimizador é **número de transações por janela**, não "ETH por janela". Consequência direta: a formulação passa de LP contínuo para **MILP** (variáveis inteiras).

**Motivo:** Gas Used é fixo pelo tipo de operação (~21.000 gas para transferência simples, ~150.000 gas para um swap), independente do valor movimentado. Um investidor que precisa mover volume alto normalmente faz isso via várias transações separadas (múltiplas posições, rebalanceamento) — o gas não "desconta" por mover mais valor numa transação só. Isso significa que o formulário de entrada do otimizador deveria pedir "quantas transações" (N), não "quanto volume" — ou o time precisa converter volume→N antes de alimentar o solver.

*(Isso revisa a decisão 3 original deste documento, que assumia LP puramente contínuo.)*

---

## 4. Moeda interna do otimizador: ETH/gas nativo, conversão para USD só na exibição

**Decisão:** O modelo roda internamente em gwei/ETH nativo. Conversão para dólar só na exibição (plano recomendado e relatório do backtest).

**Motivo (raciocínio interno):** se o câmbio ETH/USD for aproximadamente constante durante o horizonte de decisão (horas), a alocação ótima é a mesma otimizando em ETH ou USD (multiplicar a função objetivo por uma constante não muda o argmin). Evita introduzir volatilidade cambial como ruído extra. No backtest, dá pra usar câmbio histórico real por janela para reportar economia em dólar com mais precisão.

**Confirmação (simulação corrigida):** ETH em 2026 tem volatilidade implícita anual em torno de 80% (índice EVIX), equivalente a ~0,86% de volatilidade horária. Teste isolado corretamente (mesma alocação em ambos os cenários — decidida só por gas, como o sistema real faz — variando apenas como o câmbio entra na conversão final para USD, em 800 cenários com hora de início aleatória): erro médio de +0,16% (sem viés relevante), P5-P95 entre -4,1% e +4,8%, pior caso observado ±11%. Pequeno e consistente frente às variações de gas (centenas de %). **Decisão confirmada: câmbio constante é simplificação segura.**

---

## 5. One-shot vs. reotimização (rolling horizon): começar com one-shot

**Decisão:** MVP entrega recomendação única (one-shot) por chamada. Rolling horizon fica registrado como próximo passo.

**Motivo:** mais simples de implementar/testar/explicar dado o prazo de 4 semanas. O endpoint `/optimize` recebe "transações restantes" e "tempo restante até o deadline" como parâmetros — reotimizar no futuro é a mesma chamada com números atualizados, sem remodelar a interface.

---

## 6. Teto por janela: ~30% de N, validado por simulação Monte Carlo

**Status:** decisão inicial fechada, a recalibrar com dado histórico real.

**O problema que resolve:** sem teto, o MILP tende a concentrar as transações na janela de menor custo previsto — ótimo se a previsão estiver certa, arriscado se não estiver.

**Simulação realizada:** Monte Carlo com 500 cenários sintéticos, decisão feita com base numa **previsão** (média sazonal, sem picos) e custo avaliado no **preço real simulado** (que inclui picos aleatórios de cauda pesada, calibrados a partir da literatura de skewness/kurtose do gas). Resultado:

| Estratégia | Mediana | P99 | Pior caso |
|---|---|---|---|
| Tudo de uma vez (t=0) | 589.782 | 2.395.631 | 12.833.891 |
| Sem teto | 564.896 | 7.084.573 | 21.761.601 |
| **Teto = 30% de N** | 577.348 | 4.529.209 | 7.734.872 |
| Teto = 10% de N | 635.659 | 2.612.503 | 4.372.121 |

"Sem teto" tem a melhor mediana, mas no pior caso fica quase 3x mais caro que a versão com teto de 30%. Com teto de 30%, a mediana piora pouco (~2%) mas o pior caso cai à metade.

**Evidência externa de que teto por janela é prática padrão:** em mercados financeiros regulados, restringir participação por período é exigência legal (Regra 611 da SEC, MiFID II na Europa). TWAP, o algoritmo mais usado da área, divide a ordem em pedaços iguais por intervalo — essencialmente a mesma lógica. Um estudo formal testou tetos de 40% e 20% do volume por período, com o mesmo padrão (mais restrição = mais lento, mais espalhado).

**Ressalva:** simulação usa parâmetros sintéticos ilustrativos (calibrados a partir de literatura, não de histórico real do time). Recalibrar quando o pipeline de ingestão estiver capturando dado de verdade.

**Correção de viabilidade (achado ao revisar a formulação):** a regra "teto = 30% de N" pode ficar matematicamente inviável em horizontes curtos. Testado: com deadline de 2h (2 janelas) e N=20, capacidade máxima seria 12 — mas 20 foram pedidas, o solver retorna infeasible (confirmado via `scipy.optimize.milp`). Fórmula corrigida e testada, viável em qualquer horizonte:

```
teto = max( ⌈0,3 × N⌉ , ⌈N / nº de janelas do horizonte⌉ )
```

Preserva o comportamento original (30% de N) quando o horizonte é longo o bastante, e relaxa o teto automaticamente só o necessário pra garantir viabilidade em horizontes curtos. Testado com 24, 6, 2 e 1 janela — viável em todos.

**Fontes:**
- Meister, B.K. & Price, H.C.W. — ["Gas Fees on the Ethereum Blockchain"](https://arxiv.org/pdf/2406.06524) (arXiv:2406.06524, 2024) — skewness/kurtose do gas
- ["Safe and Compliant Cross-Market Trade Execution..."](https://arxiv.org/pdf/2510.04952) (arXiv:2510.04952) — SEC Rule 611, MiFID II
- Guéant, O. — ["Execution and block trade pricing with optimal constant rate of participation"](https://arxiv.org/pdf/1210.7608) (arXiv:1210.7608)
- ["A convex duality method for optimal liquidation with participation constraints"](https://arxiv.org/pdf/1407.4614) (arXiv:1407.4614)

---

## 7. Mínimo por janela / início forçado — **testado e descartado**

**Decisão final:** não implementar mínimo por janela nem "início forçado". O teto de 30% (decisão 6) já é a proteção suficiente.

**Por quê (achado contraintuitivo, testado corretamente):** simulação Monte Carlo com 800 cenários, hora de início do horizonte aleatorizada (correção do teste anterior, que não estressava a restrição de verdade). Resultado: forçar 30% de execução na primeira metade do horizonte piorou tanto a mediana (+0,45%) quanto o pior caso (**+28,0%**) e o P99 (+17,2%), comparado a usar só o teto.

**Explicação do mecanismo:** a lógica de TWAP/participation-rate em finanças tradicionais existe para limitar *impacto de mercado* — a própria negociação move o preço. No nosso caso, o preço de gas é exógeno (a transação do usuário não o afeta). O risco real é erro de previsão em qualquer janela específica, que o teto já mitiga ao espalhar a execução por várias janelas. Forçar início cedo apenas remove flexibilidade de seguir uma previsão sazonal que, na maioria das vezes, está correta — sem oferecer proteção equivalente em troca.

**Lição para o time:** nem toda prática consagrada de execução em mercados tradicionais se transfere diretamente para este problema — a mecânica de risco é diferente (preço exógeno vs. impacto de mercado).

---

## 8. Estimador de custo por janela: decomposição hora-do-dia + dia-da-semana (testada e validada)

> **A ORDEM das etapas foi corrigida em 29/08/2026 — ver decisão 17.** A fórmula abaixo
> continua válida; o que mudou é que o fator de dia da semana passou a ser estimado
> **antes** do Holt-Winters, direto do dado, em vez de sair do resíduo dele.

**Decisão final (revisada após teste):** `custo_i = nível_e_sazonalidade_hora(hora de i) × fator_dia_da_semana(dia de i)`, calculado em duas etapas:

1. **Hora do dia:** suavização exponencial sazonal (Holt-Winters, sem tendência, sazonalidade multiplicativa, período=24h) via `statsmodels.tsa.holtwinters.ExponentialSmoothing` — parâmetros de suavização ajustados automaticamente por máxima verossimilhança, não escolhidos à mão
2. **Dia da semana:** resíduo do modelo de hora (observado ÷ previsto), com a média desse resíduo agrupada por dia da semana — captura separadamente o desconto de fim de semana
3. As duas estimativas são multiplicadas para chegar no `custo_i` final de cada janela

**O que foi testado e descartado antes de chegar aqui:** a ideia original (um único modelo sazonal com 168 posições — uma para cada combinação hora×dia) foi testada e **falhou**: com poucas semanas de histórico, cada uma das 168 posições tem observações demais escassas para se ajustar, o parâmetro de sazonalidade convergiu para zero (o modelo "desistiu" de aprender o padrão), e o resultado ficou pior que uma simples média histórica. A decomposição em dois fatores separados (24 + 7 parâmetros, não 168) resolve isso ao usar muito mais dado por parâmetro estimado.

**Validação:** simulação com dado sintético (gerado com sazonalidade real de hora+dia conhecida), testando de 4 a 52 semanas de histórico disponível, média de 5 sementes aleatórias por cenário. A decomposição hora+dia bateu a média histórica simples em todos os cenários testados (ex: 12 semanas de histórico — 35,3% de erro vs. 75,8% da média simples).

**Analogia de domínio:** essa é uma técnica padrão para séries com duas sazonalidades aninhadas (hora + dia da semana) — usada, por exemplo, em previsão de demanda de energia elétrica, que tem exatamente esse mesmo padrão.

**Pendência:** revalidar com dado real de gas assim que o pipeline de ingestão estiver capturando histórico de verdade — o teste acima usa dado sintético.

**Fontes:**
- Marchioro, M. — ["Ethereum: how to save even more on gas price with a weekly plan"](https://medium.com/dextf/ethereum-how-to-save-even-more-on-gas-price-with-a-weekly-plan-c6689ac09fe6)
- Meister & Price (arXiv:2406.06524) — Apêndice B, sazonalidade horária

---

## 9. Solver: `scipy.optimize.milp` (não `linprog`, não PuLP/OR-Tools)

**Decisão:** usar `scipy.optimize.milp` (backend HiGHS), que resolve o problema como MILP (variáveis inteiras — contagem de transações), consistente com a correção da decisão 3.

**Motivo:** mantém tudo no ecossistema scipy, sem adicionar PuLP/OR-Tools como dependência nova. Resolve em milissegundos mesmo com dezenas/centenas de transações e 24 janelas — desempenho não é preocupação.

---

## 10. Baseline "ingênuo" do backtest: execução imediata (t=0)

**Decisão:** o baseline principal de comparação no backtest é "executar tudo de uma vez, assim que decidido" (t=0) — o comportamento mais realista de um investidor que não pensa em timing. TWAP puro (distribuição igual entre janelas) entra como comparação secundária.

---

## 11. Visualização: lightweight-charts + Apache ECharts

**Decisão:** lightweight-charts (TradingView) para o gráfico contínuo em tempo real; Apache ECharts para calendário semanal (heatmap por hora) e agregados.

**Motivo:** lightweight-charts é construída para séries temporais financeiras com streaming ao vivo. ECharts tem heatmap de calendário nativo, pedido explícito do parceiro.

---

## 12. Arquitetura do solver: worker Python containerizado (FastAPI + Docker)

**Decisão:** serviço Python (FastAPI), endpoint `POST /optimize`, containerizado, chamado de forma síncrona pelo backend Node via `docker-compose`. Backtest roda como job batch offline separado.

**Motivo:** ecossistema científico/OR de Python é mais maduro. Chamada síncrona é suficiente (resolve em milissegundos). Backtest é separado para evitar timeout de requisição longa.

---

## 13. Simplificações conscientes da modelagem (não são lacunas, mas devem ficar explícitas)

A formulação matemática do otimizador (decisões 3, 6, 9) está fechada e testada. Duas simplificações foram escolhas deliberadas de escopo, não pontos em aberto — registradas aqui para o time não confundir "decisão consciente" com "esquecimento":

- **Teto como restrição heurística de risco, não otimização formal risco-retorno:** a literatura de execução (Almgren-Chriss) usa um termo de variância explícito na função objetivo; nós usamos uma restrição rígida (teto) como proxy mais simples. Válido para o MVP, evolutivo se sobrar tempo.
- **Gas fixo único (`GAS_USED`) para todas as N transações:** assume que todas as transações são do mesmo tipo de operação (ex: todas swaps). Se o uso real do parceiro envolver tipos diferentes de transação, seria necessário um `GAS_USED_i` por transação — vale confirmar com o parceiro antes de assumir homogeneidade.

---

## 14. Banco: TimescaleDB, com gapfill na leitura

**Decisão:** TimescaleDB (Postgres + extensão de séries temporais) em vez de Postgres puro. Hypertable `bloco_gas` para a captura por bloco, continuous aggregates `gas_1min` e `gas_1h`, função `serie_horaria(início, fim)` para a série que alimenta o estimador. Schema em `db/init/01_schema.sql`.

**Motivo:** a decisão 1 descreve exatamente o padrão que a extensão resolve nativamente (bruto por evento + rollups materializados). Mesma superfície SQL do Postgres, sem custo de aprendizado extra.

**Duas escolhas dentro do schema que merecem registro:**

- **As agregações saem direto da hypertable, não em cascata.** Seria mais barato construir `gas_1h` sobre `gas_1min`, mas mediana não é composável: a mediana de 60 medianas de 1min não é a mediana da hora. Média/mín/máx seriam composáveis — manter as duas com a mesma fonte evita ter métricas com semânticas diferentes na mesma linha.
- **Valores gravados em wei (`BIGINT`), não gwei.** Wei é o inteiro exato que o RPC devolve; converter na gravação introduziria arredondamento. `BIGINT` tem ~6 ordens de grandeza de folga (1000 gwei = 1e12 wei; limite do tipo = 9,2e18). Conversão para gwei acontece na leitura.

**Sobre buracos na série:** a decisão 8 exige série horária contígua — o Holt-Winters sazonal quebra se faltar hora, e queda de rede ou reorg produzem buraco. Resolvido com `time_bucket_gapfill` + `interpolate()` **na leitura**, dentro de `serie_horaria()`. Nunca se grava linha sintética no banco: o dado bruto continua sendo só o que foi de fato observado.

---

## 15. O endpoint `/optimize` faz estimativa E otimização

**Decisão:** o backend Node envia a série histórica horária (de `serie_horaria()`) junto com `N`, `horas_ate_deadline` e `gas_used`; o solver treina o estimador e resolve o MILP numa chamada só.

**Motivo:** o diagrama 9.2 da arquitetura originalmente punha o cálculo do custo no Node ("busca custo estimado por janela (média móvel)"). Isso fazia sentido enquanto o estimador era uma média móvel, calculável em SQL. A **decisão 8 tornou isso Python-only** — Holt-Winters via `statsmodels`, que o Node não executa. Manter a estimativa junto do MILP evita um serviço intermediário ou uma reimplementação do estimador em JavaScript.

**Custo aceito:** `/optimize` fica com duas responsabilidades. Se aparecer necessidade de cachear a estimativa separadamente (ela é bem mais cara que o MILP), dá pra quebrar em `/estimate` + `/optimize` sem mudar o contrato com o frontend.

---

## 16. Horizonte parcial: truncar para baixo

**Decisão:** deadline que não cai em fronteira de hora é **truncado para baixo** — 5h30 vira 5 janelas de 1h. *(Fecha a pendência que estava em aberto neste documento.)*

**Motivo:** conservador por construção — nunca recomenda executar depois do prazo real do usuário. As alternativas: arredondar para cima alocaria transação numa janela que ultrapassa o deadline (inaceitável para o usuário institucional, que tem prazo contratual); janela parcial com peso proporcional aproveitaria o horizonte inteiro, mas deixa o teto por janela com semântica estranha (o que significa "30% de N" numa janela de 30 minutos?).

**Custo aceito:** perde-se até 59 minutos de oportunidade. Irrelevante num horizonte de 24 janelas; relevante num horizonte de 2 — daí o erro 422 explícito quando o horizonte trunca para zero janelas.

---

## 17. Correção da etapa 2 do estimador: fator de dia da semana antes do Holt-Winters

**Problema encontrado (29/08/2026):** a etapa 2 da decisão 8 não estava recuperando o efeito de dia da semana. Medido com dado sintético de razão realizada conhecida: recuperava 0,90–0,98 quando a razão de fato no dado era ~0,61 — ou seja, quase nada do efeito.

**Causa raiz — é uma questão de ORDEM, não de fórmula.** A versão original ajustava o Holt-Winters primeiro e tirava o fator de dia do resíduo (`observado ÷ previsto`). Mas o nível do Holt-Winters é uma média móvel que persegue a observação: com `alpha` ajustado por máxima verossimilhança entre 0,22 e 1,00, ele absorvia a queda de fim de semana **conforme ela acontecia**, e o resíduo voltava a ~1,0 em todo dia da semana. O efeito nunca chegava à etapa 2. O `gamma` (suavização sazonal) também colapsou para 0,000 nos testes — mesmo modo de falha que a decisão 8 atribui ao modelo de 168 posições descartado.

**Correção:** inverter a ordem.

1. Fator de dia da semana estimado **primeiro, direto do dado bruto**, a partir das **médias diárias**. Cada dia calendário contém as 24 horas, então a média diária já está livre da sazonalidade de hora do dia — a razão entre a média de um dia e a média global isola o efeito do dia da semana sem contaminação. Usa **mediana** entre as semanas, não média: gas tem cauda pesada (decisão 6) e um único pico de 15x num sábado não pode redefinir o fator de sábado.
2. A série é dividida por esse fator, ficando neutra quanto a dia da semana.
3. O Holt-Winters é ajustado na série já ajustada — o nível não tem mais padrão semanal para perseguir.
4. Na previsão, as duas estimativas voltam a ser multiplicadas (fórmula da decisão 8, inalterada).

**Por que isso importa — o defeito distorcia a decisão, não só o custo reportado.** Em horizonte de 24h o erro era inofensivo: o nível do Holt-Winters fica congelado no último ponto, então o erro era *uniforme* nas 24 horas, e o MILP é invariante a escala — a ordenação das janelas não mudava. A partir de 48h o erro deixa de ser uniforme e o otimizador passava a **ignorar o fim de semana inteiro**, que é justamente a janela mais barata.

| Horizonte | Perda vs. onisciente (antes) | Depois | Aloca no fds (antes → depois) |
|---|---|---|---|
| 24h | 0,01% | 0,59% | 70% → 100% |
| 48h | **50,9%** | **0,70%** | 0% → 100% |
| 72h | **51,0%** | **0,72%** | 0% → 100% |
| 96h | **51,5%** | **0,72%** | 0% → 100% |

*(Referência: o otimizador onisciente, com previsão perfeita, aloca 90–100% no fim de semana.)*

**Custo aceito:** o caso de 24h piorou de leve — captura 95,0% do ganho teórico contra 99,2% antes. É ruído de amostragem do fator (com 4 semanas há só 4 sábados para estimar o fator de sábado). Troca claramente favorável: 4 pontos percentuais no caso curto contra 50 no caso longo. O estimador continua batendo a média histórica simples em **100%** das origens testadas.

**Estabilidade vs. histórico disponível:** desvio-padrão da razão fim-de-semana/útil entre sementes — 0,066 com 2 semanas, 0,028 com 4 semanas (mínimo recomendado), 0,017 com 26. Encolhimento (shrinkage) do fator em direção a 1,0 foi considerado para o caso de pouco histórico e **descartado**: complexidade sem ganho claro a partir de 4 semanas.

**Ressalva:** validação em dado sintético. O desconto de fim de semana injetado (~0,55–0,61) é provavelmente mais forte e mais limpo que o real, então os 50% de perda evitada são teto, não estimativa. Revalidar com dado real de gas — a pendência da decisão 8 continua de pé.

---

## 18. Ingestão RPC: dois caminhos, e o limite de histórico do provedor

**Decisão:** `viem` (não ethers.js) — TypeScript-first, tipagem melhor. Provedor configurável por `RPC_HTTP_URL`/`RPC_WS_URL`, então serve Alchemy, Infura, publicnode ou nó próprio.

**Dois caminhos, porque um só não resolve:**

| | Ao vivo (`ingestao.ts`) | Backfill (`backfill.ts`) |
|---|---|---|
| Gatilho | assinatura `newHeads` via WebSocket | sob demanda: `npm run backfill -- <horas>` |
| Fonte | header do bloco + `eth_feeHistory` de 1 bloco | `eth_feeHistory` em lotes de 1024 |
| `momento` | timestamp real do header | interpolado entre âncoras reais |
| `gas_used`/`gas_limit` | preenchidos | **NULL** — `feeHistory` não devolve |

O backfill existe porque o estimador precisa de ~4 semanas (decisão 8) e a ingestão ao vivo levaria 4 semanas para acumular isso. Usa `feeHistory` em lote porque header a header seriam ~200 mil chamadas para 4 semanas, contra ~200.

**LIMITE DE HISTÓRICO DO PROVEDOR — fecha a pendência que estava aberta.** Medido no endpoint público `ethereum-rpc.publicnode.com` em 29/08/2026:

- `eth_feeHistory` com `blockCount=1024` a partir de `latest`: **funciona** — 3,4h de histórico
- `eth_feeHistory` com **número de bloco explícito**: só até ~32 blocos da cabeça (~6 min). Além disso o nó responde `Archive requests require a personal token`

Ou seja: **no endpoint público o backfill trava em ~3,4 horas.** Para as ~4 semanas que o estimador precisa, é obrigatório uma chave Alchemy ou Infura. O backfill detecta a recusa, para limpo e avisa quantas horas conseguiu — não estoura.

**Consequência de cronograma:** enquanto não houver chave, o `/optimize` não roda com dado real (ele exige no mínimo 48h de histórico). A ingestão ao vivo acumula ~24h por dia, então mesmo sem chave o histórico se forma sozinho — só leva tempo.

---

## 19. Timestamps do backfill: interpolação por trechos, e a armadilha da chave primária

Duas correções feitas ao validar a ingestão contra a mainnet, ambas achadas por medição e não por leitura de código.

**a) Interpolação de timestamp precisa de âncoras intermediárias.** `eth_feeHistory` não devolve timestamp. A primeira versão ancorava só nas pontas de cada lote de 1024 blocos e interpolava linearmente a 12s. Erro medido: **até 12 segundos** — um bloco inteiro, o bastante para jogar o registro no balde de 1min errado. Causa: pós-merge os slots são de 12s exatos, mas slot perdido (~0,5-1%) faz o relógio real descolar da contagem de blocos. Corrigido ancorando a cada **128 blocos** (~9 chamadas por lote em vez de 2): erro caiu para **0,8s em média, 7s no pior caso**, com 9 de 12 blocos amostrados exatos.

**b) A chave primária NÃO deduplica bloco.** A PK é `(momento, block_number)` — a hypertable exige a coluna de tempo em qualquer índice único, então não dá para ter `UNIQUE(block_number)`. Mas o backfill grava momento *interpolado* e a ingestão ao vivo grava o momento *real*: para o mesmo bloco os dois diferem em alguns segundos, o `ON CONFLICT` não disparava e **o bloco entrava duas vezes**. Confirmado em dado real — 8 blocos duplicados na sobreposição entre os dois caminhos. Corrigido com `NOT EXISTS` por `block_number` na query de inserção; quem chega primeiro no bloco vence. Verificado depois: 0 duplicatas, 0 intervalos negativos, intervalo médio 12,04s.

---

## 20. Testes do solver: suíte `pytest` versionada e imagem de teste separada

Até aqui as verificações do solver eram scripts de medição rodados à mão e descartados. Isso foi suficiente para *descobrir* a inversão da etapa 2 (decisão 17), mas não impede que ela volte — e é justamente o tipo de bug que não levanta exceção: o módulo roda, só entrega número errado. A suíte agora mora em `apps/solver/tests/` e é rodada por `./scripts/testar-solver.sh`.

**Três escolhas que valem registro:**

**a) O teste do MILP compara com força bruta, não com valor esperado fixo.** Em instâncias pequenas (M ≤ 5, N ≤ 12) o ótimo é enumerável, então o teste calcula o ótimo exato e exige igualdade. Um valor cravado à mão só testaria que o resultado não mudou; a força bruta testa que ele está *certo*.

**b) O estimador é comparado com a razão REALIZADA no dado, não com o parâmetro nominal.** O gerador sintético injeta fator 0,55 de fim de semana, mas a reversão à média e o ruído deslocam o que de fato aparece na série (0,551–0,557 nas sementes testadas). Cobrar 0,55 exato seria cobrar do estimador algo que o dado não contém. O helper `razao_realizada()` mede o alvo diretamente da série gerada.

**c) O teste de regressão da decisão 17 reimplementa a ordem antiga.** Em vez de só verificar que a ordem atual acerta, ele executa as duas e exige que a atual seja ao menos 10× mais precisa. Medido com semente 0: o alvo realizado na série é 0,5565; a ordem atual recupera 0,5582 (**erro de 0,32%**) e a ordem antiga recupera 0,9884 (**erro de 77,6%**) — ou seja, ela conclui que praticamente *não existe* efeito de dia da semana. O alpha ajustado do Holt-Winters nessa série é 0,752, alto o bastante para o nível perseguir a queda de fim de semana e não sobrar nada dela no resíduo. A margem real entre as duas ordens é de ~240×; o teste cobra 10× para não ficar frágil a semente. Se alguém reinverter as etapas, quebra aqui com mensagem dizendo o quê.

**A suíte foi validada por mutação**, não só por passar: inverter a ordem das etapas derruba 9 testes, trocar o teto de 30% por 100% derruba 7, e truncar o horizonte para cima em vez de para baixo derruba 3. Suíte que passa mas não falha quando o código quebra não protege nada.

**Imagem de teste separada da de produção.** `pytest` e `httpx` ficam em `requirements-dev.txt`; a imagem que a Alphractal executa não os contém. O script de teste constrói uma imagem própria e traz o código por bind mount, para editar teste não exigir rebuild.

---

## 21. O `Dockerfile` do solver copiava os módulos um a um — e um ficou de fora

`COPY main.py estimador_custo.py ./` não incluía `otimizador.py`. A imagem subia normalmente em desenvolvimento **porque o compose monta `./apps/solver:/app` por cima**, e o bind mount repunha o arquivo faltante. Rodando a imagem sozinha — que é exatamente como ela rodaria em produção — `import main` falhava com `ModuleNotFoundError: No module named 'otimizador'`.

Corrigido com `COPY *.py ./`. A lição não é sobre esse arquivo específico: **listar módulo a módulo cria uma lista que precisa ser mantida em sincronia com o diretório**, e o bind mount de dev garante que ninguém perceba quando ela sai de sincronia. Vale para qualquer serviço do projeto.

Junto disso, dois ajustes: as versões em `requirements.txt` foram **pinadas** (`pandas 3.0.5`, `numpy 2.4.6`, `scipy 1.17.1`, `statsmodels 0.15.0` — majors recentes, build de hoje não é build da demo), e o `--reload` saiu do `CMD` da imagem para o `command:` do compose, já que reload é característica de desenvolvimento, não da imagem entregue.

---

## 22. Integração backend Node → solver: `POST /otimizar`

O `SOLVER_URL` estava no compose desde o esqueleto, mas nenhum arquivo em `src/` o usava — o solver existia e ninguém o chamava. O endpoint `POST /otimizar` fecha isso: lê a série horária do banco, chama o `/optimize` do solver e devolve o plano. Quem consome não precisa saber que existe um serviço Python atrás.

**Quem lê o banco é o Node, não o solver.** O solver continua stateless e sem credencial de banco (decisão 12): recebe a série no corpo do pedido. Mantém as credenciais num serviço só e deixa o solver testável sem infraestrutura — foi o que permitiu os 62 testes da decisão 20 rodarem sem subir Postgres.

**Dois status diferentes para duas falhas diferentes.** Entrada malformada é **422**; histórico insuficiente no banco é **503**. A distinção importa: histórico curto não é erro de quem chamou, é estado do sistema — e é a resposta que mais vai aparecer enquanto não houver chave de RPC (decisão 18). Por isso o corpo do 503 traz um campo `como_resolver` dizendo o que fazer, em vez de só constatar o problema.

**A série sai do relógio do banco, não do Node.** O limite superior é `date_trunc('hour', now())` calculado em SQL. Dois motivos: exclui a hora em curso, que seria a média de uma hora pela metade — mais ruidosa que as demais bem no ponto em que o Holt-Winters mais pesa; e evita divergência de alguns segundos entre os relógios dos containers, à qual o balde de 1h é sensível.

**Filtrar `NULL` da série é seguro** porque `serie_horaria()` já aplica `interpolate()`: buraco no meio vem preenchido, e o que sobra `NULL` são só as bordas, antes do primeiro bloco e depois do último. Verificado com o seed, que tem um buraco proposital de 3h — as 672 horas voltaram contíguas.

**`GAS_USED` aceita dois caminhos:** o número pronto, para quem já o tem, ou um objeto `transacao` que o backend estima via `eth_estimateGas`. Ambos verificados contra a mainnet.

**Nomenclatura:** o endpoint público é `/otimizar` (português, pela convenção do projeto), o interno do solver segue `/optimize`, como já estava na arquitetura e na decisão 15. A inconsistência é consciente — o `/optimize` é fronteira interna entre serviços, não a API do produto.

**Verificado ponta a ponta** com as 5 semanas do seed: 672h de histórico contíguo, plano de 50 transações em 24 janelas somando exatamente 50, 28,16% de economia contra o baseline t=0, resposta em **90ms**. Os caminhos de 422 (5 casos), o 503 de histórico insuficiente e o 503 de solver fora do ar foram todos exercitados.

---

## 23. Dois defeitos que o modo de desenvolvimento escondia

Ambos apareceram só ao integrar, e a causa é a mesma: o caminho de dev não exercita o que produção exercita.

**a) `npm run build` estava quebrado.** O `buscarFeeHistory` montava `{ blockNumber, blockTag }` com um dos dois `undefined`, mas o tipo do viem é uma **união** — as duas chaves não podem coexistir no objeto, nem com valor `undefined`. O `npm run dev` usa `tsx`, que transpila sem checar tipos, então o erro nunca apareceu. Corrigido escolhendo o objeto inteiro conforme o caso, em vez de montar um objeto com chaves condicionais.

**b) O `express.json()` nunca foi montado.** Não fazia falta enquanto só havia rotas GET. O primeiro POST chegaria com `req.body` indefinido e falharia de um jeito difícil de ler.

**c) Não havia lockfile no backend.** O `Dockerfile` rodava `npm install` a partir do `package.json` apenas, então cada build resolvia as versões de novo — o mesmo problema que o pin do `requirements.txt` resolveu no solver (decisão 21). Agora o `package-lock.json` é versionado e a imagem usa `npm ci`, que instala exatamente o que está travado e falha se o lock divergir do `package.json`.

Junto com o `Dockerfile` da decisão 21, são três defeitos da mesma família: **o ambiente de desenvolvimento é mais permissivo que o de produção, então passar em dev não é evidência de nada.** Vale como argumento para ligar CI cedo — um `tsc --noEmit` em push teria pego o (a) no dia em que entrou.

---

## 24. Rotas do painel e entrega em tempo real por SSE

O backend expunha só `/health` e `/otimizar`. Para o painel funcionar faltavam as leituras e o streaming.

**As leituras saem das agregações contínuas, não da hypertable.** `gas_1min` alimenta o gráfico ao vivo, `gas_1h` o calendário. Varrer `bloco_gas` a cada requisição seria varrer centenas de milhares de linhas para desenhar algumas dezenas de pontos.

**Agregação em tempo real precisou ser ligada.** As duas views nasceram com `materialized_only = true`, e a política de refresh tem `end_offset` de 1 minuto — ou seja, o balde corrente ficava de fora e o `gas_1min` devolvia no máximo o minuto anterior. Até ~2 minutos de atraso num gráfico que se diz tempo real. Com `materialized_only = false` a consulta une o materializado com os blocos do balde ainda aberto. O custo é unir duas fontes; irrelevante nas janelas curtas do painel.

**SSE, não WebSocket** (já previsto no TAP, agora implementado): o tráfego é unidirecional, e o `EventSource` do navegador reconecta sozinho. WebSocket seria bidirecional sem ninguém usando a volta.

**O barramento de eventos é em memória e isolado** (`eventos.ts`). A ingestão não sabe que HTTP existe; o `/stream` não sabe de onde veio o bloco. Um processo Node atende todas as conexões e todos recebem o mesmo evento — não há estado por usuário, fila ou entrega garantida a implementar. Com mais de uma instância do backend seria preciso um pub/sub externo; hoje seria complexidade sem uso.

**Publica só o que foi gravado.** Bloco duplicado (`gravarBlocos` devolve 0) não vira evento — senão o painel desenharia o mesmo ponto duas vezes na sobreposição entre backfill e ingestão ao vivo.

**CORS escrito à mão**, seis linhas, sem adicionar o pacote `cors`. O `*` serve enquanto a API é pública e sem autenticação; com login por cookie ou token isso precisa virar lista de origens, porque `*` é incompatível com credenciais.

**A moda usa histograma adaptativo, não balde fixo.** A primeira versão agrupava em baldes de 0,1 gwei. Com a mainnet perto de 0,06 gwei todos os blocos caíam no mesmo balde e a moda saía **0,1 — maior que o máximo observado (0,089)**, um valor inexistente na série. O mesmo balde fixo seria fino demais numa época de gas a 80 gwei. Agora são 40 faixas entre o mínimo e o máximo do dia, devolvendo o centro da mais populosa: funciona nas duas escalas sem constante para sintonizar.

---

## 25. Trava contra histórico defasado no `/otimizar`

O solver prevê a partir da hora **seguinte** ao último ponto do histórico. Se a série estiver velha, a "janela 0" do plano cai no passado e a recomendação é para um período que já terminou — devolvida com **status 200 e nenhum sinal do problema**.

Não é hipótese: aconteceu depois de uma noite com a máquina desligada. O dado sintético terminava em 31/08 00:03, a ingestão só voltou em 01/09 00:24, e o `/otimizar` respondeu 200 com um plano cuja primeira janela era 31/08 01:00 — 24 horas no passado.

O backend agora compara o fim da série com o relógio e responde **503** acima do limite, com `por_que`, `como_resolver`, `serie_ate` e `defasagem_horas` no corpo. Mesma filosofia do 503 de histórico insuficiente: erro silencioso vira erro visível.

**O limite é 3h, e o número não é folga arbitrária.** A série termina na última hora *cheia*, então às 10h59 o último ponto é o das 09h00 — 1h59 de idade mesmo com ingestão perfeita. Um limite de 2h dispararia falso positivo todo fim de hora. 3h dá uma hora de margem real.

O `/health` também passou a expor `defasagem_minutos` do último bloco, para o problema ser visível antes de alguém chamar o otimizador.

---

## 26. Gráficos: duas bibliotecas, carregadas sob demanda

**Duas bibliotecas, e não por inconsistência.** `lightweight-charts` desenha em canvas e foi feito para série financeira com streaming: `update()` mexe só no último ponto, sem redesenhar a série a cada bloco. Mas ele não tem heatmap de calendário — é especializado em série temporal. O ECharts tem, e é o formato que o parceiro pediu. Cada uma cobre o que a outra não faz.

**Import dinâmico foi necessário, não enfeite.** Somadas, as duas levaram o bundle de 260 kB para **939 kB** (310 kB comprimidos). Com `React.lazy`, o principal voltou a 261 kB e os gráficos viraram pedaços separados — 167 kB o de linha, 510 kB o heatmap — carregados só por quem abre a tela que desenha. A tela de login não paga nada.

O import do ECharts já era modular (`echarts/core` + heatmap, grid, tooltip, visualMap, canvas). Os 510 kB são o custo real desse conjunto; o pacote inteiro passa de 1 MB.

**A escala de cor do heatmap corta nos percentis 5 e 95, não no mínimo e máximo.** Com escala linear entre os extremos, o gas revelou o problema na primeira renderização: um único pico de 2,41 gwei consumiu toda a faixa de cor e as outras ~160 células viraram o mesmo azul-escuro. O heatmap ficava bonito e não informava nada. Cortando no percentil 95 (1,14 gwei), a variação do dia a dia recupera a faixa; valores acima saturam na cor do topo, que é a leitura correta — "isto foi caro". Uma nota abaixo do gráfico informa o corte e o pico real, para o dado não ser escondido.

**O gráfico ao vivo junta duas fontes.** O histórico vem do `/gas/recente` (série de 1 min); os pontos novos vêm do `/stream` por `EventSource`. O `update()` do lightweight-charts substitui o ponto quando o timestamp é igual ao último e adiciona quando é maior — exatamente o comportamento desejado, já que vários blocos caem no mesmo minuto. Blocos com timestamp anterior ao último desenhado são descartados.

**Sem `VITE_API_URL` o stream é simulado** a cada 12 s, o mesmo ritmo da rede. Assim a interface pode ser demonstrada sem Docker, com o gráfico se movendo de verdade.

---

## 27. Três defeitos que só apareceram com a interface rodando

Nenhum deles aparece em teste de unidade, em `tsc` ou em `curl`. Todos exigiram abrir o navegador.

**a) O CORS bloqueava toda chamada.** A lista `Access-Control-Allow-Headers` tinha só `Content-Type`, mas o frontend manda `Authorization: Bearer` da sessão em toda requisição. Um cabeçalho não listado faz o preflight falhar e o navegador nem envia a requisição real. Invisível no `curl`, que não faz preflight sem ser mandado.

**b) A tela de login despejava HTML de erro no formulário.** Com a API real configurada, o `POST /auth/login` batia num backend sem autenticação e o `Cannot POST /auth/login` do Express aparecia cru dentro do campo. Corrigido em duas frentes: as rotas `/auth/` vão sempre para o backend simulado (o Fees Monitor não tem login; a tela é a casca do shell da plataforma), e o `api.ts` deixou de exibir resposta que comece com `<`.

**c) As listas truncavam texto com reticências.** O `.row` era um grid de 5 colunas fixas, dimensionado para a lista de ativos do shell original (ticker, nome, barra, valor, tag). As telas de gas usam combinações diferentes, então os elementos caíam em colunas de largura errada: `0,0816 gwei/gas` virava `0,081…` e "Ingestão ao vivo" virava "Ingest…". Trocado por flex, onde cada elemento declara o próprio comportamento e a linha funciona com dois ou cinco filhos.

---

## 28. Conversão para dólar na exibição

O objetivo formal do TAP é "converter dados brutos da blockchain (gas) em indicadores financeiros instantâneos (USD)", e a decisão 4 já previa a conversão só na camada de exibição. O painel estava mostrando tudo em gwei — a conversão faltava.

**gwei não converte direto para dólar.** É preço POR UNIDADE de gas, não um valor: "0,089 gwei" não tem equivalente em dinheiro sem multiplicar pelo gas consumido. Isso obriga a escolher uma **transação de referência** para os cartões de estatística, e a escolha foi 21.000 — o custo fixo de uma transferência simples de ETH, o menor possível e o mais reconhecível. O número exibido é portanto um piso: uma swap consome ~150.000. A referência aparece na própria tela, para ninguém ler como "custo médio de uma transação".

No otimizador não há essa ambiguidade: `custo_total_gwei` já é um total (Σ xᵢ × gas_used × custoᵢ), então converte direto. A **economia em dólar** virou o número principal da tela, com o percentual como legenda — é o que decide, e é o que a Alphractal vai olhar.

**A cotação sai da chave que já existe.** A URL do RPC da Alchemy contém a chave, e a mesma chave serve na Prices API deles — evita pedir uma segunda credencial. Com outro provedor (Infura, nó próprio) o padrão não casa e o código cai no CoinGecko, que é público e sem chave. As duas fontes foram conferidas entre si: US$ 2.462,07 contra 2.460,91, 0,05% de diferença.

**Cache de 60 s, com compartilhamento de requisições em voo.** Gas muda a cada 12 s, o preço do ETH não tanto. E como três rotas do painel pedem cotação ao mesmo tempo, sem o compartilhamento seriam três chamadas externas idênticas a cada carregamento de tela.

**Cotação indisponível não derruba nada.** Os campos em dólar vêm `null` e a interface mostra gwei; se houver cotação anterior em cache, ela é mantida em vez de sumir — um preço de minutos atrás é melhor que nenhum. O painel de gas é a função principal e não pode depender de uma API de preço.

**No heatmap, a conversão é aplicada aos VALORES, não só ao texto do tooltip.** Como gwei → dólar é multiplicação por constante, a escala de cor sai idêntica — as mesmas células nas mesmas cores — e a legenda e o tooltip passam a falar em dinheiro sem código de formatação especial dentro do gráfico.

**Precisão fixa em coluna, adaptativa em cartão.** A precisão por magnitude de `usd()` é certa num cartão isolado e errada numa lista de valores comparáveis: `US$ 0,017` ao lado de `US$ 0,00682` e `US$ 0,043` deixa a coluna irregular e destrói a comparação visual, que é para o que a lista existe. Em listas, `casasParaColuna()` deriva as casas do menor valor e vale para todos.

**A cotação não entra no modelo.** Continua valendo a decisão 4: multiplicar a função objetivo por uma constante não muda o argmin, então a alocação ótima é a mesma em ETH ou em USD. O módulo `cotacao.ts` não é chamado pelo solver.

---

## 29. Índice da tela de Análise: consistência do padrão, não congestão

O painel reservava um espaço para um "índice de congestão" engenheirado, análogo ao CVDD.
A frente foi encerrada sem fórmula, e o espaço precisava de um índice que valesse a tela.

**Congestão medida por ocupação de bloco foi descartada por medição, não por gosto.**
`gas_used_ratio` fica entre 0,499 e 0,517 nas 24 horas do dia, enquanto o preço varia 9×
no mesmo período:

| hora (UTC) | gas_used_ratio | preço médio |
|---|---|---|
| 02 | 0,5084 | 0,0937 gwei |
| 16 | 0,5069 | 0,8415 gwei |

Isso é o EIP-1559 funcionando como projetado: o base fee sobe justamente para manter os
blocos perto do alvo de 50% de ocupação. Nas horas caras a rede não fica mais cheia — fica
mais cara. Um índice de ocupação seria uma linha reta em 50 atravessando a tela.

**O índice adotado é a consistência de cada hora entre os dias.** O resto da página afirma
"a hora mais barata é a Xh"; sozinha, a frase é uma armadilha com 4 a 5 dias de amostra,
porque uma hora barata na média pode ser cara em três dias e baratíssima num quarto. O
índice responde se o padrão se repete, que é o que decide se dá para agendar em cima dele.

```
consistência(h) = 100 / (1 + CV(h)),  CV(h) = desvio padrão amostral / média
```

Transformação limitada e monótona: CV = 0 (a hora custa o mesmo todo dia) dá 100; CV = 1
(o desvio tem o tamanho da própria média) dá 50, que é a leitura natural de "metade do
valor é ruído". O índice da tela é a **mediana** das 24 horas, não a média — uma única hora
dominada por um pico isolado puxaria a média e faria o padrão inteiro parecer pior.

Horas com menos de dois dias de amostra devolvem `null`, não 100: afirmar consistência
perfeita a partir de uma observação seria o pior erro possível para este número.

Na amostra atual o índice dá 62, com as horas indo de 36 a 76 — e as extremas são
justamente as de pico. A figura cruza duas variáveis: altura = consistência, cor = acima ou
abaixo da mediana de preço, com marca tracejada nos 50 pontos. Sem a marca as barras leem
como um bloco uniforme, porque na prática vivem entre 35 e 80; truncar o eixo resolveria o
contraste mentindo sobre a escala.

O cálculo é do cliente, sobre a série horária que a tela já carrega — não vale rota nova
para algumas centenas de pontos já agregados pelo banco.

## 30. Remoção da tela de login e abertura no lugar dela

O Fees Monitor é um módulo da aba "Fees" da plataforma da Alphractal. A autenticação é da
plataforma; quem chega ao painel já passou por ela. A tela de login que veio junto com o
frontend do time era a casca visual do shell — bonita, sem backend por trás, e a origem de
dois defeitos já registrados (decisão 27b). Mantê-la significava demonstrar ao parceiro uma
cerimônia que não existe no produto.

**Removidos:** `LoginPage` e seu CSS (586 linhas), `SplashScreen`, `RouteGuards`,
`AuthProvider`/`AuthContext`/`useAuth`/`authService`, `lib/session.ts`, as rotas `/auth/*`
de `endpoints.ts` e do backend simulado, os tipos `User`/`Credentials`/`LoginResponse`, e
toda a passagem de token no `api.ts` — incluindo a exceção `ROTAS_SIMULADAS`, que existia
só para desviar `/auth/` para o mock. Está tudo no histórico do git se a plataforma quiser
a casca de volta.

**No lugar, uma abertura que faz trabalho real.** Em vez de um spinner por tempo fixo, ela
dispara as três chamadas que o painel precisa e acende cada uma quando responde:
`/health` (backend, banco, ingestão, solver), `/cotacao` e `/gas/estatisticas`. São três
requisições separadas de propósito — uma resposta única faria os três itens acenderem no
mesmo instante, e escalonar isso na mão seria encenação.

- **Só o `/health` bloqueia.** Sem cotação o painel mostra gwei; sem estatísticas cada tela
  tem seu próprio carregamento. Nenhuma das duas justifica segurar a aplicação na porta, e
  a lista diz "o painel abre sem isso" quando a falha é dessas — mas não quando o backend
  caiu junto, senão a ressalva mentiria.
- **O painel monta assim que o `/health` responde**, por baixo da abertura. As requisições
  dele correm durante o tempo mínimo de exibição, então quando a tela sai o conteúdo já
  está desenhado, sem esqueleto.
- **Tempo mínimo de 900 ms.** Contra a rede local as checagens voltam em dezenas de
  milissegundos, e uma tela que aparece e some nesse intervalo lê como defeito de
  renderização. O piso não atrasa nada — é sobreposto ao carregamento do painel.
- **Falha do backend vira parede com `docker compose ps` e botão de nova tentativa**, que
  refaz as checagens sem recarregar a página. Testado desligando o contêiner: a parede
  aparece, o botão recupera.

Dois defeitos corrigidos na verificação em navegador: o `TypeError: Failed to fetch` do
fetch aparecia cru na tela (vocabulário do navegador, em inglês, sem dizer o que fazer), e
o trilho de progresso ficava inteiro aceso em azul mesmo com as três checagens falhando —
dizia "pronto" enquanto nada estava.

**O cartão de usuário da barra lateral saiu junto.** Sem login não há quem identificar, e
ele exibia nome e plano vindos do backend simulado ("João Pedro · PRO") — pior que nada na
frente do parceiro. No lugar, a identificação do módulo. Quando o painel entrar na
plataforma, esse canto é da casca da Alphractal.

## 31. Trava de dominância: o otimizador nunca recomenda algo pior que não usá-lo

**O problema, medido.** Em 02/09/2026, contra a série real de mainnet, varremos os prazos
com N=50 e gas_used=21.000:

| prazo | economia | | prazo | economia |
|---|---|---|---|---|
| 2h | **−133,76%** | | 12h | **−31,94%** |
| 3h | **−169,89%** | | 20h | **−31,94%** |
| 4h | **−177,08%** | | 24h | +31,31% |
| 6h | **−68,85%** | | 48h | +55,50% |

Para prazos de 2 a 20 horas o serviço devolvia um plano **pior que não fazer nada** — e
devolvia junto com o plano, de modo que seguir a recomendação custaria dinheiro. A decisão 10
e o `test_economia_negativa_quando_t0_e_o_melhor_momento` já documentavam que a economia
podia ser negativa; o que ninguém tinha medido é **com que frequência** isso acontece em
dado real. A resposta foi: na maior parte da faixa útil de prazos.

**A causa é estrutural, não um erro de cálculo.** O MILP não tem a opção de não fazer nada:
`Σxᵢ = N` com `xᵢ ≤ teto` o **proíbe** de concentrar as N transações numa janela só sempre
que `teto < N`. Quando a janela 0 é a mais barata do horizonte — comum em prazo curto, e o
caso da série medida, em que nenhuma das 19 horas seguintes era mais barata que a atual —
ele é obrigado a espalhar para janelas piores.

**A trava.** Depois de resolver o MILP, comparar o plano com a solução trivial "tudo em
t=0" e devolver a melhor. Quando o baseline vence, `x = [N, 0, …]`, `economia_pct = 0` e
`executar_agora = true`.

Isso **não afrouxa a formulação** e não reabre a decisão 6: a comparação é entre duas
soluções viáveis do mesmo problema, e o teto continua valendo para o plano distribuído. O
baseline não o viola porque não é uma escolha do otimizador — é o que o usuário faria sem
ele. E há um argumento de mérito: o teto existe para conter **erro de previsão**, e
concentrar *agora* não tem previsão envolvida.

A garantia que passa a valer: **usar o otimizador nunca sai pior que não usá-lo; no pior
caso, empata.** Travada por `test_economia_nunca_e_negativa`, parametrizado em 7 curvas de
custo × 4 valores de N.

Três defeitos apareceram na implementação:

- **O empate virava dominância por ruído de ponto flutuante.** Com uma janela só, os dois
  custos são a mesma conta em ordem de associação diferente (`(g·c) @ x` contra `n·g·c₀`), e
  o arredondamento decidia o sinalizador. Resolvido com tolerância relativa de 1e-9 — empate
  não é o plano perdendo, é o plano *sendo* o baseline.
- **`economia_pct` chegava à tela como "−0,00%"** — o mesmo ruído, com um sinal de menos sem
  significado. Grampeada em `max(0, …)`, o que não esconde nada porque depois da trava
  economia negativa não existe mais.
- **`usd(0)` renderizava "US$ 0,0000000".** A precisão adaptativa de `formato.ts` escolhe as
  casas pela magnitude, e zero caía no ramo mais preciso. Mesma correção em `gwei(0)`.

**O backend simulado recebeu a mesma trava.** Ele não resolve MILP nenhum, mas precisa ter o
mesmo contrato de saída — senão quem desenvolve a interface sem Docker desenha para um
comportamento que não existe.

**O que a trava NÃO resolve.** `economia_pct` continua sendo economia **prevista**: tanto o
custo do plano quanto o baseline saem do estimador, então o modelo está avaliando a si
mesmo. Se a previsão errar, o ganho realizado é outro. A trava garante que o serviço não
recomenda o pior dos dois caminhos *segundo a própria previsão* — não que o +31,31% se
concretize. Medir isso é função do backtest, ainda pendente.

## 32. Backfill não atualiza as agregações contínuas sozinho

`gas_1min` e `gas_1h` têm `materialized_only = false` (decisão 24), o que faz o dado novo
aparecer sem esperar refresh. Isso vale só para o que chega **depois** da marca d'água de
materialização. O backfill escreve **atrás** dela, em buckets que a Timescale já considera
calculados — e não os recalcula.

O sintoma é traiçoeiro: `bloco_gas` fica correto, o backfill relata sucesso, e o painel e o
solver continuam enxergando o buraco. Em 02/09/2026 o backfill recuperou 6.193 blocos e
fechou o vão de 20h41 na hypertable; `gas_1h` seguiu com um buraco de **17h** até o
`refresh_continuous_aggregate` manual. Só então a série horária foi de 96h para 121h.

`backfill.ts` passou a reprocessar as duas agregações ao final, quando gravou alguma coisa,
com margem de um dia para trás para cobrir o bucket parcial na borda. `CALL` não roda dentro
de transação — pelo `pool.query` do node-postgres não há transação implícita, o que foi
verificado antes de fechar o caminho.

**Consequência prática, e é boa:** dá para desligar a máquina. Um buraco de uma noite é
recuperável por backfill enquanto estiver dentro das ~93h de alcance do `eth_feeHistory`
(decisão 18). O procedimento ao voltar é `docker compose up -d` e
`docker compose exec backend-node npm run backfill -- <horas>`.

---

## 33. Backtest do otimizador: mediana boa, cauda perigosa

`apps/solver/backtest.py` + `scripts/backtest.sh`, sobre um corpus congelado de 120h de
mainnet em `apps/solver/tests/dados/mainnet_1h.csv`. Não fala com o banco — roda em CI e é
reproduzível. Resultado completo em `docs/backtest-otimizador.md`.

**O método.** Walk-forward: para cada hora com 48h de treino antes e horizonte inteiro
depois, o plano nasce da previsão e é **cobrado pelo preço real**. É essa linha que separa o
backtest do `economia_pct` do endpoint, em que o modelo se avalia com a própria previsão.
Quatro estratégias: `agora` (baseline), `plano`, `oráculo` (o mesmo MILP com custos reais,
sob as mesmas restrições) e `uniforme`.

**O resultado, N=50, 49 origens:**

| horizonte | plano agregado | mediana | p25 | oráculo | captura | plano ≥ agora |
|---|---|---|---|---|---|---|
| 6h | −0,6% | +0,0% | −19,6% | +42,2% | −1% | 36/49 |
| 12h | −19,2% | +0,0% | −48,0% | +45,4% | −42% | 33/49 |
| 24h | **−32,9%** | +20,4% | **−601,1%** | +65,4% | **−45%** | 28/49 |

> A primeira versão desta tabela trazia "captura 76%" em 24h. Era a mediana das capturas por
> origem, apresentada ao lado de um agregado — bases diferentes. Na mesma base do agregado a
> captura é **−45%**. A métrica misturada quase virou manchete de apresentação.

**A mediana de +20,4% em 24h é uma miragem, e quase entrou na apresentação como resultado.**
No **agregado** — economia sobre a soma dos custos de todas as origens — o otimizador com o
teto atual gasta **32,9% a mais** que executar tudo imediatamente. O caso típico ganha; o
total perde, porque as perdas são muito maiores em magnitude que os ganhos. A mediana era a
métrica errada: com a trava de dominância, mais da metade das origens devolve exatamente 0% e
a mediana fica presa nesse zero enquanto as demais ganham ou perdem muito.

**A causa da cauda:** uma hora a 2,41 gwei (19× a mediana) que o estimador previu em ~0,05 —
erro de 45×. O MILP concentrou 15 das 50 transações ali. Gas tem cauda pesada e Holt-Winters
sem tendência não vê pico nenhum.

**A formulação bate o ingênuo com folga** em todos os cortes — o plano uniforme perde de 24%
a 74%. O problema não é distribuir; é *quanto* concentrar.

**A trava de dominância (decisão 31) não protege contra isso**, e é importante não confundir
as duas coisas: ela compara plano e baseline pelos custos **previstos**. Quando a previsão
erra, o plano aprovado por ela ainda pode sair muito pior na realidade.

**A varredura de teto sobre as 120h, agregado, N=50:**

| teto | 24h | 12h |
|---|---|---|
| 5 | **−0,7%** | **+6,7%** |
| 6 | −10,5% | +6,5% |
| 10 | −14,1% | +0,6% |
| 15 (decisão 6) | **−32,9%** | **−6,3%** |
| 20 | −46,3% | −10,1% |

O sinal é o mesmo nos dois horizontes: **o teto de 30% de N é permissivo demais para gas
real.** `teto = 5` (10% de N) é o melhor agregado em 24h e o único ponto claramente lucrativo
de toda a varredura em 12h. Em 24h o p25 degrada monotonicamente com o teto, de −75,9% (teto
3) a −713,1% (teto 20) — é o teto que controla a exposição ao pico.

O teto da decisão 6 foi calibrado por Monte Carlo sobre dado **sintético**, que não tem cauda
pesada. A recalibração para ~10% de N tem evidência direta, mas **é decisão de produto, não
técnica**: são 5 dias de corpus com um único pico dominando a cauda, e a decisão 6 está
declarada fechada. Fica registrado, não aplicado.

**A captura não serve para escolher o teto** — é máxima em 12 (80%), um dos piores agregados.
Mede quanto do ganho alcançável o plano pegou, não quanto dinheiro sobrou.

**Limites do resultado, e são grandes:** 120h e 49 origens; uma única hora de pico domina a
cauda inteira; o estimador roda com menos de uma semana de histórico contra as ~4 semanas que
a decisão 8 pede, com cada dia da semana aparecendo uma vez só.

## 34. Recalibração do teto: 30% → 10% de N

A decisão 6 fixou o teto por janela em ~30% de N, calibrado por Monte Carlo sobre dado
**sintético**. O backtest da decisão 33 mediu sobre mainnet e a varredura de teto foi
inequívoca nos dois horizontes (economia agregada, N=50):

| teto | 12h | 24h |
|---|---|---|
| 3 | — | −6,0% |
| **5 (10% de N)** | **+6,7%** | **−0,7%** |
| 8 | +3,7% | −15,7% |
| 10 | +0,6% | −14,1% |
| 15 (30% de N) | −6,3% | −32,9% |
| 20 | −10,1% | −46,3% |

`FRACAO_MAXIMA_POR_JANELA` passou de `0.3` para `0.1`. O segundo termo do `max`, `ceil(N/M)`,
fica intacto — é o que garante viabilidade em horizonte curto, e com a fração menor ele passa
a dominar em mais casos, então ganhou teste parametrizado próprio (`teto * M >= N` em 6
pontos, não mais um caso só).

**O efeito, medido depois de aplicar** (agregado, N=50):

| horizonte | antes | depois | plano ≥ agora |
|---|---|---|---|
| 6h | −0,6% | **+1,6%** | 36/49 → 42/49 |
| 12h | −19,2% | **+1,9%** | 33/49 → 40/49 |
| 24h | −32,9% | **−0,7%** | 28/49 → 33/49 |

**O otimizador deixou de perder dinheiro — e não passou a ganhar quase nada.** A captura vai
a 4%–7%: o oráculo encontra de +35% a +65% disponíveis sob as mesmas restrições, e o plano
pega uma fração. O teto apertado tirou a exposição ao pico e, no mesmo movimento, tirou a
capacidade de explorar as horas genuinamente baratas.

**A conclusão que importa: a restrição que morde é o estimador, não a formulação.** A
distância entre +1,9% e +45,4% em 12h é inteiramente erro de previsão. Nenhum valor de teto
fecha isso — o teto só escolhe entre perder muito e ganhar pouco. Com menos de uma semana de
histórico contra as ~4 semanas que a decisão 8 pede, é o resultado esperado.

Nota metodológica: o 10% é o melhor ponto medido, não um ótimo demonstrado. A grade foi
grossa (3, 5, 8, 10, 15, 20) sobre 49–61 origens de 5 dias, com um único pico dominando a
cauda. Vale refazer com ~4 semanas de corpus.

## 35. Testes do backend Node e CI

**`index.ts` foi partido em `app.ts` + `index.ts`.** O `app.listen()` no escopo do módulo
fazia com que qualquer `import` abrisse a porta 3000 e ligasse a ingestão — impossível
testar rota. Agora `app.ts` monta e exporta o Express, `index.ts` só sobe o servidor.

**42 testes (vitest + supertest), 39 deles sem infraestrutura nenhuma.** Banco, solver, nó
RPC e cotação são substituídos; a suíte inteira roda em ~0,5s em qualquer máquina e em CI.
O que cobrem foi escolhido pelo histórico de defeitos, não por cobertura de linha:

- **CORS** — que o preflight liste `Authorization`. Sem isso o navegador bloqueava toda
  chamada do painel, e `curl` não via nada porque `curl` não faz preflight (decisão 27).
- **Cotação** — cache de 60s, compartilhamento de requisição em voo, fallback
  Alchemy→CoinGecko, retenção do último valor quando a fonte cai, `null` sem cache.
- **Trava de defasagem** — que devolva 503 com `defasagem_horas`, e que a checagem de
  *tamanho* do histórico venha antes da de *idade* (a mensagem certa com banco vazio é
  "insuficiente", não "defasado").
- **Barramento de eventos** — o fan-out, e que um assinante que lança não derrube os
  demais nem o laço da ingestão.

Os 3 de integração ficam atrás de `TEST_DB=1`. O principal é o invariante da moda por
histograma — `mínimo ≤ moda ≤ máximo` —, que uma versão anterior violou devolvendo 0,1
gwei num dia de máximo 0,089 (decisão 27). Nenhum teste unitário pegaria isso.

**Dois defeitos meus apareceram ao escrever os testes**, e os dois são do tipo que a suíte
existe para pegar: um teste esquecia de cancelar assinaturas e contaminava o seguinte (o
`Set` vive no escopo do módulo), e eu esperava 422 na trava de defasagem quando o código
devolve 503 — o código estava certo, é indisponibilidade temporária e não pedido inválido.

**`scripts/testar-backend.sh` pergunta a porta ao compose** em vez de assumir 5432. O
projeto publica o banco em 5433 porque 5432 já estava ocupada, e bater na 5432 acerta um
Postgres da máquina e falha com "password authentication failed" — que parece credencial
errada e manda a investigação para o lado oposto.

**CI em `.github/workflows/ci.yml`**, quatro jobs paralelos em push para `main`/`develop` e
em PR: solver (99 testes), backtest com trava de regressão, backend (tsc + vitest + build)
e frontend (tsc + build). As quatro sequências foram verificadas em ambiente limpo antes de
subir, não só no ambiente de desenvolvimento.

O job do **backtest** roda `--minimo-agregado -2.0`: o corpus é congelado em git e as
dependências são pinadas, então o resultado é determinístico e dá para exigir um piso. Ele
existe para impedir que uma "melhoria" no estimador ou na formulação faça o otimizador
voltar a perder dinheiro sem ninguém perceber — que foi o estado em que ele viveu até a
decisão 34. A folga até o pior valor atual (−0,7%) é deliberada: piso apertado demais
transforma ruído numérico em build vermelho.

## 36. Tela do Solver: a curva que gerou o plano, e o histórico de execuções

**"Por que este plano"** desenha o custo previsto das 24 janelas com as escolhidas
destacadas, e uma linha tracejada no custo da janela 0. A linha é o que faz a figura
explicar sozinha: ela marca o preço de executar agora, e o otimizador só tem o que ganhar
nas barras abaixo dela. Quando nenhuma fica abaixo, a trava de dominância (decisão 31)
manda executar imediatamente — e o gráfico mostra o porquê sem texto nenhum.

Sem backend novo: `plano[].custo_i_gwei` já vinha na resposta e ninguém desenhava. Sem
biblioteca nova também — são 24 valores discretos, e o idioma de barras em CSS já existe na
Análise e na fita da tela inicial. Carregar as 170 kB do lightweight-charts numa tela que
não tinha gráfico não se justificava.

**Histórico das execuções em `localStorage`**, últimas 8, clicáveis para recarregar os
parâmetros no formulário. A alternativa — tabela no banco — foi descartada pelo custo real,
não pelo esforço de código: `db/init/` só roda com volume vazio, então uma tabela nova hoje
custaria os ~38 mil blocos de mainnet já capturados, ou forçaria a migração para migrations
versionadas no meio da semana da entrega. Para um histórico de conveniência, que serve para
comparar duas rodadas na mesma sessão, o preço não fecha.

A consequência está assumida e escrita na tela ("guardados neste navegador"): não é
compartilhado nem auditável. Se a Alphractal quiser histórico de verdade, é backend — e aí
a decisão de migrations vem junto.

Toda leitura e escrita do `localStorage` vai em try/catch: ele lança em aba anônima com
dados de site bloqueados, e um histórico de conveniência não pode derrubar a tela do
otimizador. A leitura também filtra registros fora do formato, porque o conteúdo pode ter
sido gravado por uma versão anterior do app.

Um defeito de layout apareceu na verificação: filhos diretos de `.grid--split` viram
colunas, então o painel de histórico solto abriu uma terceira coluna em vez de ficar abaixo
do formulário. Resolvido envolvendo formulário e histórico numa `.stack`.

## 37. Justificar a escolha dos horários, não só apresentá-la

A tela mostrava o plano e a curva prevista. Faltava o que responde "por que essas horas?" —
e previsão isolada não responde: quem olha não tem como saber se aquele vale das 3h é um
padrão que se repete todo dia ou um palpite do modelo.

**Linha do tempo.** 24h de preço real emendadas à previsão do horizonte, numa escala só, com
divisor no "agora" e as janelas escolhidas em verde. O real é sólido, o previsto é
translúcido — a figura não pode sugerir que previsão e realizado têm o mesmo peso de
evidência. Se o ritmo do dia se repete, o vale da direita cai no mesmo horário do vale da
esquerda, e isso é a justificativa.

**"Por que essas horas".** Confronta as horas escolhidas com o que essas mesmas horas
fizeram nos últimos 7 dias: posição histórica média entre as 24, consistência (a mesma
fórmula da decisão 29) e quanto abaixo do preço de agora estão. O painel diz explicitamente
quando as duas leituras **discordam** — previsão apostando em horas que historicamente não
eram baratas —, porque é aí que o plano está apoiado só na previsão, e a previsão é o elo
fraco medido na decisão 34.

**Relógio de parede nas janelas.** "+6h" virou "+6h / qua., 17:00". Obrigar quem lê a fazer
a conta de cabeça para saber quando agendar era uma barreira boba numa tela cujo produto é
justamente *quando* executar.

Nada disso exigiu backend novo: a previsão já vinha em `plano[].custo_i_gwei`, o histórico
sai do `/gas/calendario` que a tela de Análise já consome, e o alinhamento entre os dois vem
de `historico_ate` — a janela `i` cobre `historico_ate + (i+1)h`, porque o estimador prevê a
partir da hora seguinte ao fim do histórico.

## 38. Barra lateral: ícones e modo recolhido

Ícones nas três rotas e um botão que recolhe a barra para 76 px, mostrando só os ícones.

**Ícones desenhados à mão, não um pacote.** São quatro traçados SVG; uma biblioteca de
ícones inteira pesaria mais que eles. Todos com o mesmo `viewBox`, traço e espessura, para
alinharem na coluna. A escolha de cada um segue o que a tela faz, não a metáfora genérica:
pulso para a tela ao vivo, barras para a Análise, controles deslizantes para o Solver.

**O rótulo some da tela, não da acessibilidade.** Com a barra recolhida cada item mantém
`aria-label` (leitor de tela) e ganha `title` (mouse). Trocar o texto por ícone sem isso
deixaria a navegação inutilizável para quem depende de leitor.

**O texto encolhe em vez de sumir.** `width: 0` + `opacity: 0` com transição, e não
`display: none`: assim ele acompanha a barra durante os 220 ms em vez de piscar fora no
primeiro quadro. A transição vive na coluna do grid, para a barra e o conteúdo se moverem
juntos e o conteúdo não "pular" depois dela.

**A preferência fica em `localStorage`** — quem recolheu espera encontrar recolhido, e não há
nada aqui que justifique ida ao servidor. Leitura e escrita em try/catch, como no histórico
de execuções (decisão 36).

**Recolher não existe na barra horizontal** (≤900 px, quando ela vai para o topo): ali a
largura não é o recurso escasso. O botão some e a barra volta ao estado expandido mesmo se a
preferência salva disser o contrário — senão o modo estreito herdaria um estado que não faz
sentido nele.

## 39. Landing page e a separação entre apresentação e produto

`/` passou a ser a apresentação do projeto; o painel foi para `/painel/*`. O conteúdo sai da
documentação — problema (planejamento §2), os três fluxos e a stack (arquitetura §2 e §3), a
formulação e o estimador (decisões 3, 6, 17), os números do backtest (decisão 33) e o escopo
negativo do TAP (planejamento §3).

**A landing fica FORA da `Abertura`, e isso é o ponto da mudança.** É a página que alguém
abre para entender o que é o projeto *antes* de subir contêiner nenhum — professor, parceiro,
alguém que clonou o repositório. Se ela dependesse da verificação de prontidão, ficaria
inacessível justamente para quem ainda não rodou nada. Verificado desligando o
`backend-node`: a landing abre inteira, o distintivo de estado ao vivo simplesmente não
aparece, e o botão para o painel leva à parede da `Abertura` com a instrução de subir a
stack — que é o comportamento certo para cada um dos dois.

Todo dado dinâmico da landing é opcional e falha em silêncio. Um erro de rede não pode virar
mensagem na tela de quem só queria ler o que o projeto faz.

**A marca da barra lateral passou a levar de volta à apresentação.** Antes apontava para a
primeira aba, o que era redundante — a navegação entre abas está logo abaixo — e não havia
como voltar da aplicação para a página do projeto.

**Os números na landing são os medidos, com a ressalva junto.** +1,9% de economia agregada ao
lado dos +45,4% que a previsão perfeita acharia, e a frase de que a distância entre os dois é
erro de previsão. Publicar só o primeiro número seria vender melhor e mentir; publicar só o
segundo seria vender o que não existe.

## 40. A função objetivo desenhada como matemática

A formulação aparecia num `<pre>` monoespaçado: legível, mas com o ∑ do tamanho de uma letra
e os índices em caracteres unicode sobrescritos, que quebram conforme a fonte. Virou um
componente (`FormulaObjetivo`) com somatório de verdade — limites em cima e embaixo — e
`<sub>` reais.

**A cor codifica o papel de cada termo**, e é o que transforma a figura numa explicação em
vez de uma citação:

| cor | papel | termo |
|---|---|---|
| azul | o que o solver **decide** | `xᵢ` |
| neutro | entrada **fixa** do pedido | `gas_used`, `N`, `teto` |
| âmbar | o que vem de **previsão** | `custoᵢ` |

O âmbar não é decoração: `custoᵢ` é a única parte estimada da conta, e é o elo fraco medido
na decisão 34 — o oráculo acha +45% onde o plano captura 4%. A legenda diz isso na cara.

**Na tela do Solver a mesma fórmula aparece com os valores do pedido** no lugar dos símbolos:
`∑ xᵢ · 21.000 · custoᵢ`, `∑ xᵢ = 50`, `0 ≤ xᵢ ≤ 5`. É o que liga a matemática ao plano
desenhado logo acima, em vez de deixar a formulação como um bloco abstrato numa página
institucional.

Sem KaTeX ou MathJax: é uma expressão só, e a biblioteca custaria mais que o CSS.

Dois defeitos apareceram na verificação em navegador, nenhum visível no código:

- **O glifo ∑ é desenhado fora da caixa de linha** em boa parte das fontes. Com
  `line-height: 1` ele invadia a linha de baixo e comia o `i = 0`. Resolvido com folga
  vertical no `em` do próprio sigma, para escalar junto.
- **Os limites do somatório nas restrições ficavam a ~6 px** — 0,34em de um corpo já menor.
  Passaram a ter piso absoluto, e nas restrições o somatório entra **sem** limites: a função
  objetivo logo acima já estabeleceu que i vai de 0 a M−1, e repetir num corpo menor só
  produzia dois borrões. É a abreviação usual.

## Pendências em aberto

- ~~Fórmula do índice engenheirado de gas (análogo ao CVDD)~~ — descartado em 01/09 e
  **substituído** pelo índice de consistência do padrão horário (decisão 29). A
  `docs/estado-do-projeto.md` pedia "índice engenheirado" no piso mínimo; o que foi entregue
  é um índice diferente do previsto, com fórmula fechada e defensável — vale dizer isso na
  demo em vez de deixar parecer que o item saiu igual ao planejado
- ~~Backtest histórico~~ — feito (decisão 33). O que ele **abriu**: no agregado o otimizador
  hoje **perde dinheiro** (−32,9% em 24h com o teto atual). A varredura aponta `teto ≈ 10% de
  N`, mas recalibrar a decisão 6 é decisão de produto — pendente
- ~~Recalibrar o teto (decisão 6)~~ — feito (decisão 34): 30% → 10% de N. Refazer com ~4
  semanas de corpus e grade mais fina
- **Qualidade do estimador é o gargalo** (decisão 34) — o oráculo acha +45% em 12h e o plano
  captura 4%. Nenhum ajuste de teto fecha essa distância; é previsão, e previsão precisa de
  histórico (decisão 8 pede ~4 semanas, temos 5 dias)
- Revalidar o estimador (decisões 8 e 17) com dado real de gas — toda a validação atual é em dado
  sintético; hoje há ~95h de mainnet capturadas, suficiente para o fator de dia da semana ficar
  fraco (menos de 1 semana completa) mas já dá para checar a sazonalidade de 24h
- ~~Testes do backend Node e CI~~ — feitos (decisão 35): 42 testes no Node e quatro jobs em
  push/PR

### Resolvidas

- ~~Obter chave Alchemy/Infura~~ — obtida em 31/08; backfill de 93,4h executado (decisão 26)
- ~~Modos de dado incompatíveis (sintético vs real)~~ — o banco passou a conter só dado real de
  mainnet; o seed sintético segue disponível para dev, mas não convive mais com a série de produção
