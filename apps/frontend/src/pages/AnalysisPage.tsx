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
   * Média por hora do dia, sobre a janela carregada.
   *
   * É a mesma sazonalidade que o estimador do solver procura, mostrada de forma
   * direta: se existe hora barata e hora cara, ela aparece aqui. O cálculo é
   * feito no cliente porque são poucas centenas de pontos já agregados por hora
   * pelo banco -- não vale uma rota nova para isso.
   */
  const porHora = useMemo(() => {
    const soma = new Array<number>(24).fill(0);
    const n = new Array<number>(24).fill(0);
    for (const p of calendario.data?.serie ?? []) {
      const h = new Date(p.momento).getHours();
      soma[h] += p.media_gwei;
      n[h] += 1;
    }
    const medias = soma.map((s, h) => (n[h] ? s / n[h] : null));
    const validas = medias.filter((v): v is number => v !== null);
    return {
      medias,
      minimo: validas.length ? Math.min(...validas) : 0,
      maximo: validas.length ? Math.max(...validas) : 0,
    };
  }, [calendario.data]);

  // Casas decimais únicas para a coluna inteira, derivadas da hora mais barata.
  const casas = casasParaColuna(
    porHora.medias.filter((v): v is number => v !== null).map((v) => emDolar(v) ?? v),
  );

  const maisBarata = porHora.medias.indexOf(porHora.minimo);
  const maisCara = porHora.medias.indexOf(porHora.maximo);

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

          <Panel placeholder title="Índice de congestão" hint="Fórmula ainda em definição.">
            <div className="slot">
              <p>
                Índice engenheirado da rede, análogo ao CVDD. A fórmula ainda
                não foi definida — é a única frente sem caminho técnico fechado.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
