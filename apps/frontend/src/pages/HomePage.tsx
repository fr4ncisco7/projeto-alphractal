import { lazy, Suspense } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { useStreamBlocos } from "../hooks/useStreamBlocos";
import { endpoints } from "../lib/endpoints";
import { dataHora, desde, gwei, percentual, usd } from "../lib/formato";
import type { EstatisticasDia, Saude, SerieRecente } from "../types";
import "./pages.css";

/**
 * O gráfico entra por import dinâmico.
 *
 * lightweight-charts e ECharts somam ~700 kB minificados. Carregá-los no bundle
 * principal faria a tela de login -- que não tem gráfico nenhum -- esperar por
 * eles. Assim o custo só é pago por quem abre uma tela que desenha.
 */
const GraficoAoVivo = lazy(() =>
  import("../components/GraficoAoVivo").then((m) => ({ default: m.GraficoAoVivo })),
);

export function HomePage() {
  const estatisticas = useResource<EstatisticasDia>(endpoints.gasEstatisticas);
  const saude = useResource<Saude>(endpoints.saude);
  // 3 h de histórico: o suficiente para o gráfico ter forma sem carregar
  // milhares de pontos que ninguém enxergaria na largura do painel.
  const recente = useResource<SerieRecente>(`${endpoints.gasRecente}?minutos=180`);
  const stream = useStreamBlocos();

  const e = estatisticas.data;

  return (
    <>
      <PageHeader
        title="Gas em tempo real"
        description="Custo de execução na rede Ethereum, agregado a partir de cada bloco."
        actions={
          <button
            type="button"
            className="statebox__retry"
            onClick={() => {
              estatisticas.reload();
              saude.reload();
              recente.reload();
            }}
          >
            Atualizar
          </button>
        }
      />

      <div className="stack">
        <ResourceState
          loading={estatisticas.loading}
          error={estatisticas.error}
          onRetry={estatisticas.reload}
          skeletonRows={4}
          empty={e?.blocos === 0}
          emptyLabel="Nenhum bloco capturado hoje ainda."
        >
          {/* O custo em dólar vem primeiro: gwei diz pouco para quem decide, e o
              objetivo do projeto é justamente converter gas em indicador
              financeiro. Ocupa a linha inteira por ser o número de leitura. */}
          <div className="grid grid--metrics">
            <Cartao
              rotulo="Uma transferência simples custa"
              valor={usd(e?.custo_referencia_usd)}
              nota={
                e?.usd_por_eth
                  ? `${(e.gas_referencia ?? 21000).toLocaleString("pt-BR")} de gas ao preço mediano, com ETH a ${usd(e.usd_por_eth)}`
                  : "cotação ETH/USD indisponível — valores em gwei abaixo"
              }
            />
          </div>

          <div className="grid grid--metrics">
            {/* As três pedidas explicitamente pelo parceiro. */}
            <Cartao rotulo="Média do dia" valor={gwei(e?.media_gwei)} unidade="gwei"
                    nota="Custo efetivo médio: base fee + priority fee" />
            <Cartao rotulo="Mediana" valor={gwei(e?.mediana_gwei)} unidade="gwei"
                    nota="Metade dos blocos ficou abaixo deste valor" />
            <Cartao rotulo="Moda" valor={gwei(e?.moda_gwei)} unidade="gwei"
                    nota="Faixa de preço mais recorrente do dia" />
            <Cartao rotulo="Congestionamento" valor={percentual((e?.congestionamento_medio ?? 0) * 100)}
                    nota="Quanto do limite de gas os blocos usaram" />
          </div>

          <div className="grid grid--metrics">
            <Cartao rotulo="Mínimo" valor={gwei(e?.minimo_gwei)} unidade="gwei"
                    nota="Bloco mais barato desde a meia-noite" />
            <Cartao rotulo="Máximo" valor={gwei(e?.maximo_gwei)} unidade="gwei"
                    nota="Bloco mais caro desde a meia-noite" />
            <Cartao rotulo="Blocos hoje" valor={(e?.blocos ?? 0).toLocaleString("pt-BR")}
                    nota={`Desde ${dataHora(e?.desde)}`} />
          </div>
        </ResourceState>

        <Panel
          title="Gráfico ao vivo"
          hint="Média por minuto nas últimas 3 h, atualizada a cada bloco"
          actions={
            <span className={`tag tag--${stream.conectado ? "up" : "down"}`}>
              {stream.conectado
                ? `ao vivo · ${stream.recebidos} bloco${stream.recebidos === 1 ? "" : "s"}`
                : "desconectado"}
            </span>
          }
        >
          <ResourceState
            loading={recente.loading}
            error={recente.error}
            onRetry={recente.reload}
            skeletonRows={6}
            empty={recente.data?.pontos === 0}
            emptyLabel="Sem blocos nas últimas 3 h. A ingestão está ligada?"
          >
            <Suspense fallback={<div className="grafico" />}>
              <GraficoAoVivo
                historico={recente.data?.serie ?? []}
                ultimoBloco={stream.ultimo}
              />
            </Suspense>
          </ResourceState>
        </Panel>

        <Panel title="Estado da coleta" hint="De onde vêm os números acima">
          <ResourceState
            loading={saude.loading}
            error={saude.error}
            onRetry={saude.reload}
            skeletonRows={2}
          >
            <ul className="rows">
              <Linha rotulo="Ingestão ao vivo"
                     valor={saude.data?.ingestao === "ativa" ? "ativa" : "desligada"}
                     alerta={saude.data?.ingestao !== "ativa"} />
              <Linha rotulo="Último bloco"
                     valor={desde(saude.data?.ultimo_bloco_em)}
                     // Acima de 5 min sem bloco, algo está errado: a rede
                     // produz um a cada ~12 segundos.
                     alerta={(saude.data?.defasagem_minutos ?? 0) > 5} />
              <Linha rotulo="Blocos armazenados"
                     valor={(saude.data?.blocos ?? 0).toLocaleString("pt-BR")} />
              <Linha rotulo="Otimizador"
                     valor={saude.data?.solver === "ok" ? "disponível" : "inalcançável"}
                     alerta={saude.data?.solver !== "ok"} />
            </ul>
          </ResourceState>
        </Panel>
      </div>
    </>
  );
}

function Cartao({ rotulo, valor, unidade, nota }: {
  rotulo: string; valor: string; unidade?: string; nota: string;
}) {
  return (
    <article className="metric">
      <p className="metric__label">{rotulo}</p>
      <p className="metric__value">
        {valor}
        {unidade && <span className="metric__unit"> {unidade}</span>}
      </p>
      <p className="metric__hint">{nota}</p>
    </article>
  );
}

function Linha({ rotulo, valor, alerta = false }: {
  rotulo: string; valor: string; alerta?: boolean;
}) {
  return (
    <li className="row">
      <span className="row__name">{rotulo}</span>
      <span className={`tag tag--${alerta ? "down" : "up"}`}>{valor}</span>
    </li>
  );
}
