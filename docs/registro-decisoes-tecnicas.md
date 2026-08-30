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

## Pendências em aberto

- Fórmula do índice engenheirado de gas (análogo ao CVDD)
- **Obter chave Alchemy/Infura** — sem ela o backfill trava em 3,4h (ver decisão 18)
- Recalibrar teto (decisão 6) com dado histórico real assim que capturado
- Revalidar o estimador (decisões 8 e 17) com dado real de gas — toda a validação atual é em dado sintético
- Testes do backend Node e CI — o solver tem suíte (decisão 20), o Node ainda não, e nada roda automaticamente em push
