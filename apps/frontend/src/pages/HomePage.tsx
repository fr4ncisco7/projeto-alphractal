import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { endpoints } from "../lib/endpoints";
import type { Metric, Overview } from "../types";
import "./pages.css";

export function HomePage() {
  const overview = useResource<Overview>(endpoints.overview);

  return (
    <>
      <PageHeader
        title="Tela Inicial"
        description="Panorama do mercado consolidado a partir das métricas da Alphractal."
        actions={
          <button
            type="button"
            className="statebox__retry"
            onClick={overview.reload}
          >
            Atualizar
          </button>
        }
      />

      <div className="stack">
        <ResourceState
          loading={overview.loading}
          error={overview.error}
          onRetry={overview.reload}
          skeletonRows={4}
          empty={overview.data?.metrics.length === 0}
          emptyLabel="Nenhuma métrica disponível."
        >
          <div className="grid grid--metrics">
            {overview.data?.metrics.map((metric) => (
              <MetricCard key={metric.id} metric={metric} />
            ))}
          </div>
        </ResourceState>

        <Panel
          placeholder
          title="Gráficos"
          hint="Área reservada para séries temporais e comparativos."
        >
          <div className="slot">
            <p>
              Conecte aqui o componente de gráfico consumindo{" "}
              <code>{endpoints.overview}</code>.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  const positive = metric.change >= 0;

  return (
    <article className="metric">
      <p className="metric__label">{metric.label}</p>
      <p className="metric__value">{metric.value}</p>
      <p className={`metric__change${positive ? "" : " metric__change--down"}`}>
        {positive ? "+" : ""}
        {metric.change.toFixed(1)}%
      </p>
      <p className="metric__hint">{metric.hint}</p>
    </article>
  );
}
