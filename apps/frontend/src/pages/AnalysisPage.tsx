import { lazy, Suspense, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { endpoints } from "../lib/endpoints";
import { casasParaColuna, gwei, usd, usdFixo } from "../lib/formato";
import type { Cotacao, SerieCalendario } from "../types";
import "./pages.css";

/** Import dinâmico: o ECharts sozinho passa de 600 kB. Ver HomePage. */
const CalendarioGas = lazy(() =>
  import("../components/CalendarioGas").then((m) => ({ default: m.CalendarioGas })),
);

const DIAS = 7;

/** Mesma transação de referência da tela inicial, para os números conversarem. */
const GAS_REFERENCIA = 21_000;

export function AnalysisPage() {
  const calendario = useResource<SerieCalendario>(`${endpoints.gasCalendario}?dias=${DIAS}`);
  // Cotação em recurso separado: se ela falhar, o calendário continua em gwei
  // em vez de a página inteira mostrar erro.
  const cotacao = useResource<Cotacao>(endpoints.cotacao);

  const usdPorEth = cotacao.data?.usd_por_eth ?? null;
  const emDolar = (g: number | null) =>
    usdPorEth !== null && g !== null ? (g * GAS_REFERENCIA / 1e9) * usdPorEth : null;

  /**
   * Média por hora do dia -- e quanto cada hora se repete entre os dias.
   *
   * É a mesma sazonalidade que o estimador do solver procura, mostrada de forma
   * direta: se existe hora barata e hora cara, ela aparece aqui. O cálculo é
   * feito no cliente porque são poucas centenas de pontos já agregados por hora
   * pelo banco -- não vale uma rota nova para isso.
   *
   * A consistência sai do coeficiente de variação (desvio padrão dividido pela
   * média) daquela hora entre os dias da amostra, mapeado por `100 / (1 + CV)`.
   * A transformação é limitada e monótona: CV = 0 (a hora custa o mesmo todo
   * dia) dá 100, e CV = 1 (o desvio padrão é do tamanho da própria média) dá
   * 50, que é a leitura natural de "metade do valor é ruído".
   */
  const porHora = useMemo(() => {
    const valores: number[][] = Array.from({ length: 24 }, () => []);
    for (const p of calendario.data?.serie ?? []) {
      valores[new Date(p.momento).getHours()].push(p.media_gwei);
    }

    const medias = valores.map((v) =>
      v.length ? v.reduce((s, x) => s + x, 0) / v.length : null,
    );

    const consistencias = valores.map((v, h) => {
      const media = medias[h];
      // Com um dia só não há dispersão a medir -- devolver 100 aqui seria
      // afirmar consistência perfeita a partir de uma única observação.
      if (media === null || media <= 0 || v.length < 2) return null;
      const variancia = v.reduce((s, x) => s + (x - media) ** 2, 0) / (v.length - 1);
      return 100 / (1 + Math.sqrt(variancia) / media);
    });

    const validas = medias.filter((v): v is number => v !== null);
    const amostras = valores.map((v) => v.length).filter((n) => n > 0);

    return {
      medias,
      consistencias,
      minimo: validas.length ? Math.min(...validas) : 0,
      maximo: validas.length ? Math.max(...validas) : 0,
      medianaDasHoras: mediana(validas),
      amostraMin: amostras.length ? Math.min(...amostras) : 0,
      amostraMax: amostras.length ? Math.max(...amostras) : 0,
    };
  }, [calendario.data]);

  // Casas decimais únicas para a coluna inteira, derivadas da hora mais barata.
  const casas = casasParaColuna(
    porHora.medias.filter((v): v is number => v !== null).map((v) => emDolar(v) ?? v),
  );

  const maisBarata = porHora.medias.indexOf(porHora.minimo);
  const maisCara = porHora.medias.indexOf(porHora.maximo);

  /**
   * Índice da tela: a mediana das consistências horárias.
   *
   * Mediana, e não média, porque uma única hora dominada por um pico isolado
   * (23h, na amostra atual) puxaria a média para baixo e faria o padrão inteiro
   * parecer pior do que é.
   */
  const consistenciaGeral = mediana(
    porHora.consistencias.filter((v): v is number => v !== null),
  );

  return (
    <>
      <PageHeader
        title="Análise"
        description={`Padrão de custo por hora do dia, sobre os últimos ${DIAS} dias de blocos.`}
        actions={
          <button type="button" className="statebox__retry" onClick={calendario.reload}>
            Atualizar
          </button>
        }
      />

      <div className="grid grid--split">
        <Panel
          title="Custo por hora do dia"
          hint={
            usdPorEth !== null
              ? `Uma transferência simples em cada hora, média dos últimos ${DIAS} dias`
              : `Média de cada hora nos últimos ${DIAS} dias, em gwei`
          }
        >
          <ResourceState
            loading={calendario.loading}
            error={calendario.error}
            onRetry={calendario.reload}
            skeletonRows={6}
            empty={calendario.data?.pontos === 0}
            emptyLabel="Sem histórico suficiente para o padrão horário."
          >
            <ul className="rows">
              {porHora.medias.map((media, hora) => (
                <li key={hora} className="row">
                  <span className="row__ticker">{String(hora).padStart(2, "0")}h</span>
                  <span className="row__meter" aria-hidden="true">
                    <span
                      className="row__meter-fill"
                      style={{
                        // Largura relativa ao máximo, com piso de 4% para a
                        // hora mais barata continuar visível na barra.
                        width: media === null || porHora.maximo === 0
                          ? "0%"
                          : `${Math.max(4, (media / porHora.maximo) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="row__value">
                    {usdPorEth !== null && media !== null
                      ? usdFixo(emDolar(media), casas)
                      : gwei(media)}
                  </span>
                  {hora === maisBarata && <span className="tag tag--up">mais barata</span>}
                  {hora === maisCara && <span className="tag tag--down">pico</span>}
                </li>
              ))}
            </ul>
          </ResourceState>
        </Panel>

        <div className="stack">
          <Panel title="Leitura" hint="O que o padrão acima significa">
            <ResourceState
              loading={calendario.loading}
              error={calendario.error}
              onRetry={calendario.reload}
              skeletonRows={3}
            >
              <ul className="rows">
                <li className="row">
                  <span className="row__name">Hora mais barata</span>
                  <span className="row__value">
                    {String(maisBarata).padStart(2, "0")}h ·{" "}
                    {usdPorEth !== null ? usd(emDolar(porHora.minimo)) : `${gwei(porHora.minimo)} gwei`}
                  </span>
                </li>
                <li className="row">
                  <span className="row__name">Hora de pico</span>
                  <span className="row__value">
                    {String(maisCara).padStart(2, "0")}h ·{" "}
                    {usdPorEth !== null ? usd(emDolar(porHora.maximo)) : `${gwei(porHora.maximo)} gwei`}
                  </span>
                </li>
                <li className="row">
                  <span className="row__name">Diferença</span>
                  <span className="row__value">
                    {porHora.minimo > 0
                      ? `${(porHora.maximo / porHora.minimo).toFixed(1)}×`
                      : "—"}
                  </span>
                </li>
                <li className="row">
                  <span className="row__name">Horas na amostra</span>
                  <span className="row__value">{calendario.data?.pontos ?? 0}</span>
                </li>
              </ul>
            </ResourceState>
          </Panel>

          <Panel title="Calendário" hint={`Custo por hora, dia a dia, nos últimos ${DIAS} dias`}>
            <ResourceState
              loading={calendario.loading}
              error={calendario.error}
              onRetry={calendario.reload}
              skeletonRows={5}
              empty={calendario.data?.pontos === 0}
              emptyLabel="Sem histórico para montar o calendário."
            >
              <Suspense fallback={<div className="calendario" />}>
                <CalendarioGas
                  serie={calendario.data?.serie ?? []}
                  usdPorEth={usdPorEth}
                  gasReferencia={GAS_REFERENCIA}
                />
              </Suspense>
            </ResourceState>
          </Panel>

          <Panel
            title="Consistência do padrão"
            hint="Quanto o custo de cada hora se repete de um dia para o outro"
          >
            <ResourceState
              loading={calendario.loading}
              error={calendario.error}
              onRetry={calendario.reload}
              skeletonRows={4}
              empty={consistenciaGeral === null}
              emptyLabel={`Ainda não há dois dias completos na amostra para medir repetição.`}
            >
              <Consistencia
                consistencias={porHora.consistencias}
                medias={porHora.medias}
                medianaDasHoras={porHora.medianaDasHoras}
                geral={consistenciaGeral ?? 0}
                horaMaisBarata={maisBarata}
                amostraMin={porHora.amostraMin}
                amostraMax={porHora.amostraMax}
              />
            </ResourceState>
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Mediana de uma lista. `null` quando não há valor nenhum. */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/**
 * Consistência: o índice que faltava nesta tela.
 *
 * O resto da página afirma "a hora mais barata é a Xh". Sozinha, essa frase é
 * uma armadilha: com quatro ou cinco dias de amostra, uma hora barata na média
 * pode ser uma hora cara em três dias e baratíssima num quarto. O índice diz se
 * o padrão se repete -- ou seja, se dá para agendar em cima dele.
 *
 * A ocupação dos blocos (`gas_used_ratio`) foi descartada como índice desta
 * tela por medição: fica entre 0,499 e 0,517 nas 24 horas, porque é exatamente
 * isso que o EIP-1559 mantém ao mover o base fee. Nas horas caras a rede não
 * fica mais cheia, fica mais cara -- um índice de ocupação seria uma linha reta.
 */
function Consistencia({
  consistencias, medias, medianaDasHoras, geral, horaMaisBarata, amostraMin, amostraMax,
}: {
  consistencias: (number | null)[];
  medias: (number | null)[];
  medianaDasHoras: number | null;
  geral: number;
  horaMaisBarata: number;
  amostraMin: number;
  amostraMax: number;
}) {
  const daMaisBarata = consistencias[horaMaisBarata];

  // A hora mais consistente entre as que estão abaixo da mediana de preço: a
  // recomendação prática desta tela -- barata E repetível.
  let melhorAposta: number | null = null;
  consistencias.forEach((c, h) => {
    const m = medias[h];
    if (c === null || m === null || medianaDasHoras === null || m > medianaDasHoras) return;
    if (melhorAposta === null || c > (consistencias[melhorAposta] ?? 0)) melhorAposta = h;
  });

  return (
    <>
      <div className="indice">
        <p className={`indice__valor indice__valor--${faixa(geral)}`}>
          {geral.toFixed(0)}
          <span className="indice__escala">/100</span>
        </p>
        <p className="indice__legenda">{legenda(geral)}</p>
      </div>

      {/* Altura = consistência, cor = barato ou caro. As duas variáveis juntas
          respondem de uma olhada a pergunta que importa: a hora barata também
          é a que se repete? */}
      <div className="barras24" role="img"
           aria-label="Consistência de cada hora do dia, de 0 a 100">
        {consistencias.map((c, h) => {
          const m = medias[h];
          const caro = m !== null && medianaDasHoras !== null && m > medianaDasHoras;
          return (
            <span
              key={h}
              className={`barras24__hora barras24__hora--${c === null ? "vazia" : caro ? "caro" : "barato"}`}
              style={{ "--altura": `${c ?? 0}%` } as React.CSSProperties}
              title={
                c === null
                  ? `${String(h).padStart(2, "0")}h: amostra insuficiente`
                  : `${String(h).padStart(2, "0")}h · consistência ${c.toFixed(0)} · ${caro ? "acima" : "abaixo"} da mediana de preço`
              }
            />
          );
        })}
      </div>
      <p className="barras24__eixo">
        <span>00h</span>
        {/* A cor precisa de legenda: altura e cor carregam variáveis
            diferentes, e sem isso a figura fica ambígua. */}
        <span className="barras24__legenda">
          <i className="ponto ponto--barato" aria-hidden="true" /> barata
          <i className="ponto ponto--caro" aria-hidden="true" /> cara
          <i className="ponto ponto--linha" aria-hidden="true" /> 50 = desvio do tamanho da média
        </span>
        <span>23h</span>
      </p>

      <ul className="rows">
        <li className="row">
          <span className="row__name">Hora mais barata ({String(horaMaisBarata).padStart(2, "0")}h)</span>
          <span className={`tag tag--${daMaisBarata !== null && daMaisBarata >= 60 ? "up" : "down"}`}>
            {daMaisBarata === null ? "sem amostra" : `consistência ${daMaisBarata.toFixed(0)}`}
          </span>
        </li>
        {melhorAposta !== null && (
          <li className="row">
            <span className="row__name">Barata e mais repetível</span>
            <span className="tag tag--up">
              {String(melhorAposta as number).padStart(2, "0")}h · {(consistencias[melhorAposta] ?? 0).toFixed(0)}
            </span>
          </li>
        )}
      </ul>

      <p className="metric__hint">
        Coeficiente de variação de cada hora entre os dias, em <code>100 / (1 + CV)</code>.
        Amostra de {amostraMin === amostraMax ? amostraMin : `${amostraMin} a ${amostraMax}`} dias
        por hora — com tão poucos dias o índice é uma leitura grosseira, e serve para
        desconfiar de uma hora, não para cravar outra.
      </p>
    </>
  );
}

function faixa(v: number): "alta" | "media" | "baixa" {
  return v >= 65 ? "alta" : v >= 50 ? "media" : "baixa";
}

function legenda(v: number): string {
  if (v >= 65) return "O padrão horário se repete bem entre os dias — dá para agendar em cima dele.";
  if (v >= 50) return "O padrão se repete em parte: as horas extremas variam bastante de um dia para o outro.";
  return "O padrão varia muito entre os dias. Trate a hora mais barata como tendência, não como garantia.";
}
