# Backtest do otimizador

Corpus: 120h contíguas de mainnet, 28/08 04:00 a 02/09 03:00 UTC.
Treino mínimo 48h, `gas_used` 21,000.

| N | horizonte | origens | economia do plano (mediana, p25–p75) | agregado | oráculo | uniforme | captura | plano ≥ agora |
|---|---|---|---|---|---|---|---|---|
| 10 | 6h | 49 | **+0.0%** (-19.6 – +26.6) | -0.6% | +8.0% | -24.1% | 0% | 36/49 |
| 10 | 12h | 49 | **+0.0%** (-48.0 – +40.0) | -19.2% | +26.6% | -72.0% | 43% | 33/49 |
| 10 | 24h | 49 | **+20.4%** (-601.1 – +60.5) | -32.9% | +50.1% | -72.0% | 76% | 28/49 |
| 50 | 6h | 49 | **+0.0%** (-19.6 – +26.6) | -0.6% | +8.0% | -28.4% | 0% | 36/49 |
| 50 | 12h | 49 | **+0.0%** (-48.0 – +40.0) | -19.2% | +26.6% | -73.7% | 43% | 33/49 |
| 50 | 24h | 49 | **+20.4%** (-601.1 – +60.5) | -32.9% | +50.1% | -65.4% | 76% | 28/49 |

## Como ler

- **economia do plano** — economia **realizada**: o plano nasce da previsão e é cobrado pelo
  preço real que veio depois. É a diferença entre este relatório e o `economia_pct` do
  endpoint, que compara previsão com previsão.
- **oráculo** — o mesmo MILP resolvido com os custos reais, sob as mesmas restrições (teto,
  integralidade, trava de dominância). Não é um limite teórico inatingível: é o que este
  otimizador teria feito com previsão perfeita.
- **captura** — quanto da economia alcançável o plano ficou. Separa o erro do estimador do
  mérito da formulação.
- **uniforme** — N/M por janela. O ingênuo que a formulação precisa superar.
- **agregado** — economia sobre a **soma** dos custos de todas as origens. Responde "usando a
  ferramenta em todas as ocasiões, gastaria mais ou menos no total?". É a métrica que decide,
  porque a mediana ignora magnitude: com a trava de dominância mais da metade das origens
  devolve exatamente 0%, e a mediana fica presa nesse zero enquanto as demais ganham ou perdem
  muito.
- **plano ≥ agora** — em quantas origens seguir o plano não saiu pior que executar tudo agora.

## O que estes números dizem

**Em 24h a mediana é boa e a cauda é perigosa.** Economia realizada mediana de **+20,4%**,
capturando **76%** do que a previsão perfeita teria conseguido (+50,1%). Mas o percentil 25
é **−601%**: num quarto das origens o plano custou 7× o baseline, e só em **28 de 49** ele
não piorou a situação.

**A causa da cauda é o pico.** O corpus tem uma hora a 2,41 gwei — 19× a mediana de 0,127 — que
o estimador previu em ~0,05 (erro de 45×). O MILP concentrou 15 das 50 transações ali. Gas tem
cauda pesada, e Holt-Winters com sazonalidade multiplicativa e sem tendência não vê pico algum.

**Em 6h não há o que ganhar.** O próprio oráculo só encontra +8,0%. A trava de dominância
manda executar agora na maioria das origens, e faz certo — a captura de 0% não é falha da
previsão, é ausência de oportunidade.

**A formulação supera o ingênuo com folga.** O plano uniforme perde de 24% a 74% em todos os
cortes. Distribuir de qualquer jeito é muito pior que não distribuir; é o MILP que produz a
diferença.

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

**A mediana de +20,4% em 24h era uma miragem.** No agregado, o teto atual de 15 gasta
**32,9% a mais** que executar tudo imediatamente. O caso típico ganha; o total perde, porque
as perdas são muito maiores em magnitude do que os ganhos. Apresentar a mediana sozinha teria
sido enganoso.

**O teto de 30% de N é permissivo demais para gas real.** O sinal é o mesmo nos dois
horizontes: `teto = 5` (10% de N) é o melhor agregado em 24h (−0,7%, empate técnico) e em 12h
(**+6,7%**, o único ponto claramente lucrativo de toda a varredura). O teto atual dá −32,9% e
−6,3% nos mesmos cortes.

**A cauda é o que o teto controla.** Em 24h o p25 vai de −75,9% (teto 3) a −713,1% (teto 20),
monotonicamente. Concentrar em horas previstas baratas só compensa quando a previsão acerta,
e o pico de 19× é exatamente onde ela erra mais.

**A captura não serve para escolher o teto.** Ela é máxima em 12 (80%) — um dos piores
agregados. Mede quanto do ganho alcançável o plano pegou, não quanto dinheiro sobrou.

## O que fazer com isso

1. **Recalibrar o teto da decisão 6 para ~10% de N**, mantendo o segundo termo `N/M` que
   garante viabilidade. É a mudança com evidência direta — mas é a decisão 6, fechada, e a
   evidência são 5 dias com um único pico dominando a cauda. Decisão de produto, não técnica.
2. **Tratar a cauda explicitamente** — teto dependente da incerteza da previsão, ou limite de
   perda por janela. Mudança de formulação maior (decisões 6 e 7).
3. **Mais corpus.** Com ~4 semanas o estimador sai de subalimentado e a cauda passa a ter mais
   de um evento para descrever.
