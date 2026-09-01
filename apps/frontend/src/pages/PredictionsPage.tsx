import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { endpoints } from "../lib/endpoints";
import type { Predictions } from "../types";
import "./pages.css";

export function PredictionsPage() {
  const predictions = useResource<Predictions>(endpoints.predictions);

  return (
    <>
      <PageHeader
        title="Predições"
        description="Projeções geradas pelos modelos da Alphractal, com nível de confiança."
        actions={
          <button
            type="button"
            className="statebox__retry"
            onClick={predictions.reload}
          >
            Atualizar
          </button>
        }
      />

      <div className="stack">
        <Panel
          title="Últimas projeções"
          hint={
            predictions.data
              ? `Geradas em ${formatDateTime(predictions.data.generatedAt)}`
              : undefined
          }
        >
          <ResourceState
            loading={predictions.loading}
            error={predictions.error}
            onRetry={predictions.reload}
            skeletonRows={3}
            empty={predictions.data?.items.length === 0}
            emptyLabel="Nenhuma projeção disponível."
          >
            <ul className="rows">
              {predictions.data?.items.map((item) => (
                <li key={item.id} className="row">
                  <span className="row__ticker">{item.asset}</span>
                  <span className="row__name">{item.horizon}</span>
                  <span className="row__meter" aria-hidden="true">
                    <span
                      className="row__meter-fill"
                      style={{ width: `${Math.round(item.confidence * 100)}%` }}
                    />
                  </span>
                  <span className="row__value">
                    {Math.round(item.confidence * 100)}%
                  </span>
                  <span
                    className={`tag tag--${item.direction === "up" ? "up" : "down"}`}
                  >
                    {item.direction === "up" ? "Alta" : "Baixa"}
                  </span>
                </li>
              ))}
            </ul>
          </ResourceState>
        </Panel>

        <Panel
          placeholder
          title="Backtest do modelo"
          hint="Área reservada para acurácia histórica e cenários."
        >
          <div className="slot">
            <p>
              Conecte aqui o resultado do backtest consumindo{" "}
              <code>{endpoints.predictions}</code>.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
