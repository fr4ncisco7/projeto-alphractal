# Backtest do otimizador

Corpus: 120h contíguas de mainnet, 28/08 04:00 a 02/09 03:00 UTC.
Treino mínimo 48h, `gas_used` 21,000.

| N | horizonte | origens | plano agregado | (mediana, p25–p75) | oráculo | uniforme | captura | plano ≥ agora |
|---|---|---|---|---|---|---|---|---|
| 10 | 6h | 49 | **+3.1%** | +0.0% (+0.0 – +6.3) | +42.2% | -2.4% | 7% | 41/49 |
| 10 | 12h | 49 | **+1.9%** | +0.0% (+0.0 – +0.0) | +45.4% | -4.5% | 4% | 40/49 |
| 10 | 24h | 49 | **-0.7%** | +0.0% (-132.8 – +52.4) | +65.4% | -4.5% | -1% | 33/49 |
| 50 | 6h | 49 | **+1.6%** | +0.0% (+0.0 – +0.0) | +35.6% | -2.6% | 5% | 42/49 |
| 50 | 12h | 49 | **+1.9%** | +0.0% (+0.0 – +0.0) | +45.4% | -5.4% | 4% | 40/49 |
| 50 | 24h | 49 | **-0.7%** | +0.0% (-132.8 – +52.4) | +65.4% | -3.8% | -1% | 33/49 |

## Como ler

- **economia do plano** — economia **realizada**: o plano nasce da previsão e é cobrado pelo
  preço real que veio depois. É a diferença entre este relatório e o `economia_pct` do
  endpoint, que compara previsão com previsão.
- **oráculo** — o mesmo MILP resolvido com os custos reais, sob as mesmas restrições (teto,
  integralidade, trava de dominância). Não é um limite teórico inatingível: é o que este
  otimizador teria feito com previsão perfeita.
- **captura** — quanto da economia alcançável o plano ficou, **também no agregado**. Uma
  versão anterior comparava plano em agregado com oráculo em mediana — bases diferentes, e o
  número saía sem sentido (dava "76%" onde o agregado era −45%).
- **uniforme** — N/M por janela. O ingênuo que a formulação precisa superar.
- **agregado** — economia sobre a **soma** dos custos de todas as origens. Responde "usando a
  ferramenta em todas as ocasiões, gastaria mais ou menos no total?". É a métrica que decide,
  porque a mediana ignora magnitude: com a trava de dominância mais da metade das origens
  devolve exatamente 0%, e a mediana fica presa nesse zero enquanto as demais ganham ou perdem
  muito.
- **plano ≥ agora** — em quantas origens seguir o plano não saiu pior que executar tudo agora.

## O que estes números dizem

Com o teto recalibrado para 10% de N (decisão 34), N=50:

| horizonte | plano | oráculo | uniforme | captura | plano ≥ agora |
|---|---|---|---|---|---|
| 6h | **+1,6%** | +35,6% | −2,6% | 5% | 42/49 |
| 12h | **+1,9%** | +45,4% | −5,4% | 4% | 40/49 |
| 24h | **−0,7%** | +65,4% | −3,8% | −1% | 33/49 |

**O otimizador deixou de perder dinheiro.** Antes da recalibração o agregado era −0,6%,
−19,2% e −32,9% nos mesmos cortes. Agora é positivo em 6h e 12h e empata em 24h. A fração de
origens em que seguir o plano não piorou a situação subiu de 36/49 para 42/49 (6h) e de 28/49
para 33/49 (24h).

**E deixou de ganhar quase tudo junto.** O oráculo encontra de +35% a +65% disponíveis; o
plano captura **4% a 7%**. O teto apertado tirou a exposição ao pico e, no mesmo movimento,
tirou a capacidade de explorar as horas genuinamente baratas.

**A restrição que morde agora é o estimador, não a formulação.** A distância entre +1,9% e
+45,4% em 12h é inteiramente erro de previsão: o MILP com custos reais, sob as mesmas
restrições, acharia 24× mais economia. Mexer no teto não fecha essa distância — só escolhe
entre perder muito e ganhar pouco.

**A formulação continua batendo o ingênuo**, mas por pouco agora: o uniforme perde de 2,4% a
5,4%, contra os 24%–74% de antes. Com o teto em 10% o plano do MILP e o espalhamento uniforme
se aproximam, o que é esperado — teto baixo força distribuição.

## Limites deste resultado

- **120h de corpus, 49 origens.** É pouco. Uma única hora de pico domina a cauda inteira —
  com 5 dias de dado, um outlier não é uma distribuição.
- **O estimador está subalimentado.** A decisão 8 pede ~4 semanas (672h) para o fator de dia
  da semana ser confiável; ele está rodando com 48–120h, menos de uma semana. Cada dia da
  semana aparece uma vez só.
- **Todas as origens compartilham o mesmo horizonte máximo** (24h) para os cortes serem
  comparáveis entre si. Horizontes curtos poderiam ter mais origens do que têm aqui.
- **`gas_used` fixo em 21.000** e uma transação de referência só.

## Varredura de teto

O teto da decisão 6 — `max(30% de N, N/M)` — foi calibrado por Monte Carlo sobre dado
**sintético**, que não tem a cauda pesada do gas real. Refeita a pergunta sobre a mainnet
(`./scripts/backtest.sh --tetos ... --horizontes ...`), N=50:

**Horizonte 24h, 49 origens** (teto da decisão 6 = 15):

| teto | mediana | p25 | p75 | agregado | captura | plano ≥ agora |
|---|---|---|---|---|---|---|
| 3 | +0,0% | −75,9% | +10,7% | **−6,0%** | 30% | 34/49 |
| 4 | +0,0% | −133,2% | +30,4% | **−9,3%** | 59% | 33/49 |
| **5** | +0,0% | −132,8% | +52,4% | **−0,7%** | 75% | 33/49 |
| 6 | +0,0% | −309,8% | +50,7% | **−10,5%** | 71% | 29/49 |
| 8 | +0,0% | −414,5% | +59,5% | **−15,7%** | 78% | 26/49 |
| 10 | +0,0% | −411,2% | +60,2% | **−14,1%** | 79% | 27/49 |
| 12 | +0,0% | −488,7% | +60,0% | **−15,8%** | 80% | 26/49 |
| 15 ← | +20,4% | −601,1% | +60,5% | **−32,9%** | 76% | 28/49 |
| 20 | +21,2% | −713,1% | +60,8% | **−46,3%** | 70% | 28/49 |

**Horizonte 12h, 61 origens** (teto da decisão 6 = 15):

| teto | mediana | p25 | p75 | agregado | captura | plano ≥ agora |
|---|---|---|---|---|---|---|
| **5** | +0,0% | +0,0% | +3,9% | **+6,7%** | 45% | 52/61 |
| 6 | +0,0% | +0,0% | +10,2% | **+6,5%** | 53% | 52/61 |
| 8 | +0,0% | −3,0% | +39,2% | **+3,7%** | 49% | 46/61 |
| 10 | +0,0% | −33,2% | +40,4% | **+0,6%** | 62% | 43/61 |
| 12 | +0,0% | −31,3% | +48,1% | **+2,7%** | 60% | 42/61 |
| 15 ← | +0,0% | −34,3% | +46,9% | **−6,3%** | 57% | 43/61 |
| 20 | +0,0% | −30,0% | +49,8% | **−10,1%** | 45% | 41/61 |
| 25 | +0,0% | −24,3% | +55,7% | **−7,8%** | 56% | 42/61 |

### A leitura

**A mediana de +20,4% em 24h era uma miragem.** No agregado, o teto antigo de 15 gastava
**32,9% a mais** que executar tudo imediatamente. O caso típico ganhava; o total perdia,
porque as perdas eram muito maiores em magnitude do que os ganhos. Apresentar a mediana
sozinha teria sido enganoso.

**O teto de 30% de N é permissivo demais para gas real.** O sinal é o mesmo nos dois
horizontes: `teto = 5` (10% de N) é o melhor agregado em 24h (−0,7%) e em 12h (+6,7%, o único
ponto claramente lucrativo de toda a varredura).

**A cauda é o que o teto controla.** Em 24h o p25 vai de −75,9% (teto 3) a −713,1% (teto 20),
monotonicamente. Concentrar em horas previstas baratas só compensa quando a previsão acerta, e
o pico de 19× é exatamente onde ela erra mais.

**Mas nenhum teto resolve o problema de fundo.** A captura é sempre baixa ou negativa: 15% no
melhor ponto (teto 5, 12h). O teto escolhe entre perder muito e ganhar pouco — quem decide
quanto há para ganhar é a qualidade da previsão.

## O que fazer com isso

1. **Recalibrar o teto da decisão 6 para ~10% de N**, mantendo o segundo termo `N/M` que
   garante viabilidade. É a mudança com evidência direta — mas é a decisão 6, fechada, e a
   evidência são 5 dias com um único pico dominando a cauda. Decisão de produto, não técnica.
2. **Tratar a cauda explicitamente** — teto dependente da incerteza da previsão, ou limite de
   perda por janela. Mudança de formulação maior (decisões 6 e 7).
3. **Mais corpus.** Com ~4 semanas o estimador sai de subalimentado e a cauda passa a ter mais
   de um evento para descrever.
