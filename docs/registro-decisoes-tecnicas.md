# Registro de Decisões Técnicas — Otimizador de Execução & Pipeline de Dados

> Documento vivo. Cada entrada registra o que foi decidido, por quê, e as fontes que embasaram a escolha (quando aplicável). Atualizar conforme o projeto avança — decisões em aberto ficam marcadas como tal.

**Última atualização:** 24/08/2026

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



- Fórmula do índice engenheirado de gas (análogo ao CVDD)
- Limite de histórico disponível no provedor RPC (Alchemy/Infura)
- Recalibrar teto (decisão 6) com dado histórico real assim que capturado
- Tratamento de horizonte parcial (deadline que não cai em fronteira de hora)
