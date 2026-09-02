import { gwei, percentual } from "../lib/formato";
import type { JanelaPlano, PontoSerie } from "../types";
import "../pages/pages.css";

/**
 * Confronta as horas escolhidas com o que essas mesmas horas fizeram no passado.
 *
 * O gráfico de previsão mostra o que o modelo ACHA. Isto mostra se o modelo
 * está apostando em horas que historicamente se comportam assim -- que é a
 * diferença entre "o solver escolheu" e "há motivo para acreditar". As duas
 * leituras podem discordar, e quando discordam é sinal de desconfiar do plano.
 */

interface PerfilDaHora {
  media: number;
  consistencia: number | null;
  amostras: number;
  /** 1 = a hora mais barata do dia, 24 = a mais cara. */
  posicao: number;
}

/** Média, consistência e ranking de cada hora do dia, sobre o histórico. */
export function perfilarHoras(historico: PontoSerie[]): (PerfilDaHora | null)[] {
  const valores: number[][] = Array.from({ length: 24 }, () => []);
  for (const p of historico) valores[new Date(p.momento).getHours()].push(p.media_gwei);

  const medias = valores.map((v) =>
    v.length ? v.reduce((s, x) => s + x, 0) / v.length : null,
  );

  // Ranking por preço médio; horas sem amostra ficam de fora.
  const ordenadas = medias
    .map((m, h) => ({ m, h }))
    .filter((e): e is { m: number; h: number } => e.m !== null)
    .sort((a, b) => a.m - b.m);
  const posicoes = new Map(ordenadas.map((e, i) => [e.h, i + 1]));

  return medias.map((media, h) => {
    if (media === null || media <= 0) return null;
    const v = valores[h];
    // Mesma fórmula da tela de Análise (decisão 29): 100/(1+CV), com null
    // quando há menos de dois dias -- um ponto só não mede repetição.
    let consistencia: number | null = null;
    if (v.length >= 2) {
      const variancia = v.reduce((s, x) => s + (x - media) ** 2, 0) / (v.length - 1);
      consistencia = 100 / (1 + Math.sqrt(variancia) / media);
    }
    return { media, consistencia, amostras: v.length, posicao: posicoes.get(h) ?? 24 };
  });
}

export function JustificativaDasHoras({ plano, historico, dias }: {
  plano: JanelaPlano[];
  historico: PontoSerie[];
  dias: number;
}) {
  const perfis = perfilarHoras(historico);
  const escolhidas = plano.filter((j) => j.x > 0);
  if (escolhidas.length === 0 || historico.length === 0) return null;

  // A janela i cai em `agora + (i+1)h`; a hora do dia sai daí.
  const agora = Date.now();
  const horasEscolhidas = escolhidas.map((j) =>
    new Date(agora + (j.janela + 1) * 3_600_000).getHours(),
  );

  const perfisEscolhidos = horasEscolhidas
    .map((h) => perfis[h])
    .filter((p): p is PerfilDaHora => p !== null);

  if (perfisEscolhidos.length === 0) return null;

  const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const posicaoMedia = media(perfisEscolhidos.map((p) => p.posicao));
  const consistencias = perfisEscolhidos
    .map((p) => p.consistencia)
    .filter((c): c is number => c !== null);
  const consistenciaMedia = consistencias.length ? media(consistencias) : null;

  const custoAgora = plano[0]?.custo_i_gwei ?? 0;
  const custoEscolhido = media(escolhidas.map((j) => j.custo_i_gwei));
  const abaixo = custoAgora > 0 ? (1 - custoEscolhido / custoAgora) * 100 : 0;

  const horasUnicas = [...new Set(horasEscolhidas)].sort((a, b) => a - b);

  return (
    <>
      <ul className="rows">
        <li className="row">
          <span className="row__name">Horas do dia escolhidas</span>
          <span className="row__value">
            {horasUnicas.map((h) => `${String(h).padStart(2, "0")}h`).join(", ")}
          </span>
        </li>
        <li className="row">
          <span className="row__name">Custo previsto delas, contra agora</span>
          <span className={`tag tag--${abaixo > 0 ? "up" : "down"}`}>
            {gwei(custoEscolhido)} gwei · {percentual(Math.abs(abaixo), 0)}{" "}
            {abaixo > 0 ? "abaixo" : "acima"}
          </span>
        </li>
        <li className="row">
          <span className="row__name">Posição histórica média dessas horas</span>
          <span className={`tag tag--${posicaoMedia <= 12 ? "up" : "down"}`}>
            {posicaoMedia.toFixed(0)}ª mais barata de 24
          </span>
        </li>
        {consistenciaMedia !== null && (
          <li className="row">
            <span className="row__name">Consistência dessas horas</span>
            <span className={`tag tag--${consistenciaMedia >= 60 ? "up" : "down"}`}>
              {consistenciaMedia.toFixed(0)} de 100
            </span>
          </li>
        )}
      </ul>

      <p className="metric__hint">
        {/* O ponto todo do painel: quando as duas leituras discordam, o plano
            está apoiado só na previsão, e a previsão é o elo fraco (decisão 34). */}
        {posicaoMedia <= 12
          ? `A previsão e o histórico concordam: essas horas também foram as mais baratas nos últimos ${dias} dias.`
          : `Atenção: a previsão escolheu horas que, nos últimos ${dias} dias, NÃO estavam entre as mais baratas. ` +
            `O plano está apoiado só na previsão.`}{" "}
        Consistência mede o quanto cada hora se repete de um dia para o outro; abaixo de 50, o
        desvio é do tamanho da própria média.
      </p>
    </>
  );
}
