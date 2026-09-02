# Backtest do otimizador

Corpus: 120h contíguas de mainnet, 28/08 04:00 a 02/09 03:00 UTC.
Treino mínimo 48h, `gas_used` 21,000.

| N | horizonte | origens | economia do plano (mediana, p25–p75) | oráculo | uniforme | captura | plano ≥ agora |
|---|---|---|---|---|---|---|---|
| 10 | 6h | 49 | **+0.0%** (-19.6 – +26.6) | +8.0% | -24.1% | 0% | 36/49 |
| 10 | 12h | 49 | **+0.0%** (-48.0 – +40.0) | +26.6% | -72.0% | 43% | 33/49 |
| 10 | 24h | 49 | **+20.4%** (-601.1 – +60.5) | +50.1% | -72.0% | 76% | 28/49 |
| 50 | 6h | 49 | **+0.0%** (-19.6 – +26.6) | +8.0% | -28.4% | 0% | 36/49 |
| 50 | 12h | 49 | **+0.0%** (-48.0 – +40.0) | +26.6% | -73.7% | 43% | 33/49 |
| 50 | 24h | 49 | **+20.4%** (-601.1 – +60.5) | +50.1% | -65.4% | 76% | 28/49 |

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

## O que fazer com isso

A cauda de −601% é o número que impede recomendar o otimizador como está para prazos longos.
Duas frentes, nenhuma testada ainda:

1. **Reduzir o teto.** Uma varredura preliminar sobre o corpus anterior (96h) mostrou a
   mediana indo de −544% (teto 15) para −0,1% (teto 3): espalhar mais reduz a exposição ao
   pico. Falta refazer essa varredura sobre as 120h e ver o que acontece com a mediana boa.
2. **Tratar a cauda explicitamente** — um teto por janela que dependa da incerteza da
   previsão, ou um limite de perda por janela. É mudança de formulação (decisões 6 e 7).
