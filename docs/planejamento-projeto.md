# Planejamento do Projeto — Monitoramento de Fees em Tempo Real (Alphractal)

**Parceria:** Inteli Blockchain × Alphractal (Nortech Labs)
**Kick-off:** 14/09/2026 · **Demo final:** 05/10/2026 · **Duração:** 4 semanas
**Licença de entrega:** Open Source (MIT), repositório público

---

## 1. Contexto do parceiro

A **Alphractal** é uma plataforma de inteligência de mercado de nível institucional focada no ecossistema Web3, desenvolvida pela **Nortech Labs**. Ela centraliza e processa dados on-chain, métricas fundamentais e análise de sentimento em tempo real, atendendo gestores de fundos e investidores corporativos que buscam previsibilidade para decisões de alto valor. A plataforma hoje cobre mais de 1.500 métricas entre dados on-chain, derivativos, sentimento e macroeconomia, com modelo de assinatura (planos Pro/Max) e também uma API paga para squads técnicos.

## 2. O problema que estamos resolvendo

Hoje, a sub-aba **"Fees"** da Alphractal se baseia em médias históricas estáticas, o que cria um ponto cego em relação à volatilidade instantânea da mempool da rede Ethereum. Isso expõe usuários institucionais e gestores de fundos a risco de execução: operações travadas por estimativas imprecisas ou custos excessivos durante picos não previstos.

**Objetivo formal (do TAP):** desenvolver e integrar um módulo de monitoramento em tempo real na aba "Fees", convertendo dados brutos da blockchain (gas) em indicadores financeiros instantâneos (USD), entregues via painel integrado ao visual da plataforma.

## 3. Escopo

**Contempla:**
- Protótipo funcional (MVP) end-to-end, ambiente isolado
- Ingestão contínua de dados de gas/mempool da rede Ethereum
- Camada de leitura, análise e telemetria

**NÃO contempla** (definido no TAP):
- Deploy em produção ou substituição de sistemas legados da Alphractal
- Auditorias formais de segurança ou testes de estresse (load testing)
- Execução, assinatura ou automação de transações on-chain — é estritamente leitura/análise
- Deploy em mainnet ou consumo de gas real

## 4. Quem é o usuário

Vale distinguir dois públicos:

- **Assinante geral da Alphractal:** trader/investidor sério ou squad técnico que quer entender o mercado cripto de forma ampla (ciclos, fluxos de smart money, comportamento). Consome via assinatura ou API.
- **Usuário-alvo específico deste módulo:** gestor de fundo cripto ou mesa institucional que executa operações on-chain de **alto volume** na Ethereum. Ele não quer "aprender sobre o mercado" — ele quer **previsibilidade operacional no momento de decisão**: "a taxa está subindo, executo agora ou espero?". Isso reforça por que o requisito é tempo real (SSE) e por que a interface deve priorizar clareza e velocidade de leitura sobre profundidade analítica.

## 5. O que o parceiro pediu (esclarecimento via WhatsApp)

O parceiro esclareceu um ponto importante: quando fala em **"modelo de preço"**, ele se refere a **modelos de valuation** — fórmulas de engenharia com fator de ajuste — e **não** a modelos estatísticos preditivos. Os exemplos que ele deu:

- **CDD (Coin Days Destroyed)** → métrica derivada **CVDD (Cumulative Value-Days Destroyed)**, usada como modelo de valuation para Bitcoin
- **Difficulty per Issuance**, que estima o valor da rede pela dificuldade e quantidade de moedas emitidas

Pedido explícito de visualização para o gas:
- Gráfico contínuo de gas por tempo
- Visão de calendário semanal, dividida por hora
- Estatísticas: média, mediana, moda do dia
- Possibilidade de índices usando conceitos estatísticos (médias móveis, z-score)

Sugestões de diferenciais do próprio parceiro:
- Um **índice engenheirado análogo ao CVDD**, mas aplicado a gas (ainda não definido — ver seção de pendências)
- Modelos preditivos, citados como **extra opcional**, não obrigatório

**Referências enviadas pelo parceiro** (para consulta da equipe):
- CDD na plataforma: `app.alphractal.com/cryptos/chart?category=Lifespan&subCategory=Coin+Destruction+Metrics&chart=Coin+Days+Destroyed+(CDD)&asset=btc`
- Artigo original do cálculo de CVDD (Medium, @kenoshaking, "Experiments on Cumulative Destruction")
- Report da Alphractal sobre CVDD otimizado: `app.alphractal.com/research/predicting-cycle-tops-and-bottoms-the-power-of-optimized-cvdd`
- Artigo sobre Difficulty per Issuance (Medium, @paulewaulpaul)
- Há também um chart replicando esse cálculo no *workbench* da própria plataforma, compartilhado pelo parceiro na mensagem original

## 6. Nossos diferenciais estratégicos (além do pedido mínimo)

Um gráfico de gas ao longo do tempo, isoladamente, não é um diferencial real — isso já existe em exploradores públicos (Etherscan, Blocknative). Definimos três camadas de valor, em ordem de prioridade:

### 6.1 Núcleo obrigatório
Visualização de gas (gráfico contínuo, calendário por hora, estatísticas) + o índice engenheirado pedido pelo parceiro. Isso é o piso mínimo aceitável de entrega.

### 6.2 Diferencial principal — Otimizador de Execução via Pesquisa Operacional
Em vez de um modelo preditivo isolado, vamos construir um **otimizador de execução** usando Programação Linear (LP/simplex): dado um volume a executar até um deadline, o sistema recomenda como distribuir essa execução ao longo do tempo para minimizar o custo total de gas.

**Por que isso é melhor que um modelo preditivo puro:** um forecast só descreve o que pode acontecer; o otimizador responde a pergunta real do usuário institucional — "o que eu devo fazer". É a única peça do projeto que é **prescritiva**, não apenas descritiva.

**Formulação:**
- **Variáveis de decisão:** quanto volume executar em cada janela de tempo
- **Função objetivo:** minimizar custo total (soma do volume alocado × custo estimado por janela)
- **Restrições:** volume total deve ser executado até o deadline; possivelmente um teto por janela

> **⚠️ Desatualizado.** As três decisões abaixo foram revistas depois deste planejamento:
> a formulação virou **MILP** (decisão 3 — gas é custo fixo por transação, então a variável é
> contagem, que é inteira), o solver é **`scipy.optimize.milp`** (decisão 9) e o estimador é
> **Holt-Winters + fator de dia da semana** (decisão 8 — a média móvel foi testada e perdeu).
> O texto original fica aqui como registro histórico do raciocínio. Fonte da verdade:
> `docs/registro-decisoes-tecnicas.md`.

**Decisões técnicas já tomadas:**
- **LP contínuo é suficiente** — não precisamos de Branch and Bound / programação inteira, porque a alocação de volume por janela é naturalmente contínua (não há motivo de negócio para forçar valores inteiros)
- Usar bibliotecas prontas (`scipy.optimize.linprog`, PuLP, ou OR-Tools) em vez de implementar o algoritmo do zero — o esforço deve ir para a formulação do problema, não para reinventar o solver
- O otimizador precisa de uma camada de estimativa de custo por janela futura — **não precisa ser um modelo preditivo pesado**: uma média móvel por hora do dia / dia da semana já é suficiente como entrada

### 6.3 Prova de valor — Backtest histórico
Comparar, com dados históricos reais de gas, execução "ingênua" (tudo de uma vez, ou aleatória) vs. execução seguindo a recomendação do otimizador. Isso gera um número concreto de economia (%) para apresentar no Demo Day — é o que transforma "fizemos um LP" em uma prova quantificada de valor.

### 6.4 Fora do escopo desta entrega
Detecção de anomalia/fraude via ML (ambição pessoal do Francisco) fica registrada como **roadmap futuro**, mencionada na entrega mas não implementada a fundo — para não estourar o prazo de 4 semanas.

## 7. Arquitetura técnica

### 7.1 Stack (definida no TAP)
- **Frontend:** React + Vite + TypeScript
- **Backend principal:** Node.js + TypeScript
- **Conexão blockchain:** WebSockets via provedor RPC (Alchemy/Infura), usando viem ou ethers.js
- **Entrega ao painel:** SSE (Server-Sent Events)

### 7.2 Granularidade e camadas de dados
- **Captura (ingestão bruta):** nível de bloco (~12s por bloco) — necessário para de fato capturar a volatilidade instantânea da mempool, que é o próprio problema relatado pelo parceiro
- **Agregação intermediária:** 1 minuto (média/mediana/min/max dentro da janela)
- **Agregação para análise/otimizador:** 1 hora — granularidade da visão de calendário e das janelas de decisão do otimizador (não faz sentido decidir execução em intervalos de segundos)

Na prática: manter uma tabela granular por bloco e uma tabela (ou view materializada) já agregada por hora, para que o otimizador e as consultas de estatística não precisem varrer o dado bruto inteiro.

**Pendente de verificação:** limite de histórico retroativo disponível no plano do provedor RPC (Alchemy/Infura) — isso trava quanto histórico dá para usar no backtest.

### 7.3 Visualização
- **lightweight-charts** (TradingView, open source) para o gráfico contínuo em tempo real — renderização em canvas, feita especificamente para séries temporais financeiras com streaming ao vivo
- **Apache ECharts** para a visão de calendário semanal (heatmap por hora) e para gráficos agregados/estatísticos — tem suporte nativo a calendar heatmap, o que a lightweight-charts não cobre

### 7.4 Solver de otimização (Python)
- Serviço Python separado, com **FastAPI**, expondo um endpoint `POST /optimize`
- Roda como **worker containerizado** (Docker), orquestrado via `docker-compose` junto com o backend Node
- Chamada **síncrona** via HTTP interno (o LP resolve em milissegundos, não precisa de fila assíncrona)
- **Backtest histórico** roda separado, como **script/job batch offline** (não via API síncrona) — gera um resultado (JSON ou registro em banco) que o dashboard apenas lê, evitando timeout de requisição longa

## 8. Time e papéis

- **Francisco** e **um colega** compõem o time do projeto
- O colega vai focar em **desenvolvimento web** e no **solver de otimização**
- *(Papel específico de Francisco dentro dessa divisão ainda a confirmar entre vocês)*

## 9. Roadmap — sequenciamento proposto

> Princípio-chave: a formulação do LP (a parte matematicamente arriscada) deve começar **cedo, em paralelo ao dashboard** — não deixar para o final. O risco real do otimizador está em formular certo o problema de negócio, não em rodar o solver (isso é rápido). O backtest depende do solver já validado, então também não pode ficar só para a semana 4.

### Semana 1 — Fundação (kick-off 14/09)
- Reunião de kick-off com o parceiro
- Setup do repositório, esqueleto do `docker-compose` (serviço Node + serviço Python)
- Definir schema de dados: tabela de captura por bloco + tabela agregada (1min/1h)
- Prototipar conexão RPC/WebSocket para ingestão ao vivo
- Protótipo de alta fidelidade do painel (gráfico principal + visão calendário)
- **Solver:** iniciar a formulação do LP (variáveis, função objetivo, restrições) — trabalho conceitual, validar cedo com dados sintéticos
- Estudar a fundo CDD/CVDD e Difficulty per Issuance para começar a desenhar o índice engenheirado de gas

### Semana 2 — Construção do núcleo
- Backend: finalizar pipeline de ingestão (captura por bloco + agregação 1min/1h)
- Frontend: gráfico principal em tempo real (lightweight-charts) conectado via SSE
- **Solver:** primeira versão funcional do LP (scipy/PuLP) rodando no serviço FastAPI, testada com dados sintéticos, já dockerizada
- Rascunho da fórmula do índice engenheirado de gas
- Integração inicial frontend ↔ backend com dado real

### Semana 3 — Diferenciais e integração
- Frontend: visão de calendário (ECharts) + estatísticas (média/mediana/moda)
- **Solver:** conectar a estimativas reais (médias móveis por hora/dia) e integrar chamada do backend Node ao worker Python
- **Backtest:** construir o script offline comparando execução ingênua vs. otimizada sobre dado histórico real, gerar métrica de economia
- Finalizar e validar o índice engenheirado, integrar ao painel
- Início de bugfixing e polimento

### Semana 4 — Fechamento (demo 05/10)
- Integração final, correção de bugs, polimento de UI
- Consolidar resultado do backtest em uma narrativa clara (ex: "economia de X% em cenários históricos")
- Preparar a apresentação do otimizador em linguagem de negócio, já que o parceiro sinalizou que o lado dele entende pouco de desenvolvimento
- Reunião de encerramento / Demo Day

**Definição de "pronto" para a semana 4:**
- **Piso mínimo aceitável:** índice engenheirado + visualizações (gráfico contínuo + calendário) funcionando de ponta a ponta
- **Teto desejado:** piso + otimizador de execução integrado + backtest com resultado quantificado

## 10. Riscos identificados

| Risco | Mitigação |
|---|---|
| Escopo grande demais para 4 semanas (índice + otimizador + backtest) | Detecção de anomalia fica fora do escopo desta entrega; priorização clara entre piso e teto |
| Formulação errada do LP (função objetivo/restrições) | Validar formulação cedo (semana 1-2) com dados sintéticos, antes de depender dela no backtest |
| Backtest não fica pronto a tempo | Solver não pode ficar para o final — sequenciado já nas semanas 2-3 |
| Qualidade/limite de dados do provedor RPC | Verificar limites de histórico disponível antes de comprometer escopo do backtest |
| Comunicação do valor do otimizador para o parceiro | Preparar narrativa em linguagem de negócio (economia de custo), não em jargão técnico/matemático |

## 11. Pendências — decisões ainda em aberto

1. **Função objetivo e restrições exatas do LP** — precisa de uma sessão dedicada entre vocês dois para fechar a formulação matemática
2. **Fórmula do índice engenheirado de gas** (análogo ao CVDD) — ainda não definida, é matemática nova a ser proposta e validada
3. **Limite de histórico disponível no provedor RPC** — checar plano gratuito vs. pago do Alchemy/Infura
4. **Fluxo de trabalho no repositório** — estratégia de branches, revisão de PR, já que a entrega é open source (MIT)
5. **Divisão fina de responsabilidades** entre Francisco e o colega, além do que já está definido (colega: web + solver)

---

*Documento consolidado a partir das definições de planejamento entre Francisco e Claude, com base no TAP oficial do projeto e nos esclarecimentos enviados pela Alphractal via WhatsApp.*
