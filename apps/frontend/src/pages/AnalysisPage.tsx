import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { endpoints } from "../lib/endpoints";
import type { AnalysisAssets, Asset } from "../types";
import "./pages.css";

const TREND_LABEL: Record<Asset["trend"], string> = {
  up: "Alta",
  down: "Baixa",
  flat: "Lateral",
};

export function AnalysisPage() {
  const assets = useResource<AnalysisAssets>(endpoints.analysisAssets);

  return (
    <>
      <PageHeader
        title="Análise"
        description="Leitura combinada de dados on-chain, derivativos e sentimento por ativo."
      />

      <div className="grid grid--split">
        <Panel
          title="Ativos monitorados"
          hint="Score consolidado de 0 a 100"
          actions={
            <button
              type="button"
              className="statebox__retry"
              onClick={assets.reload}
            >
              Atualizar
            </button>
          }
        >
          <ResourceState
            loading={assets.loading}
            error={assets.error}
            onRetry={assets.reload}
            skeletonRows={4}
            empty={assets.data?.assets.length === 0}
            emptyLabel="Nenhum ativo monitorado."
          >
            <ul className="rows">
              {assets.data?.assets.map((asset) => (
                <li key={asset.id} className="row">
                  <span className="row__ticker">{asset.symbol}</span>
                  <span className="row__name">{asset.name}</span>
                  <span className="row__meter" aria-hidden="true">
                    <span
                      className="row__meter-fill"
                      style={{ width: `${asset.score}%` }}
                    />
                  </span>
                  <span className="row__value">{asset.score}</span>
                  <span className={`tag tag--${asset.trend}`}>
                    {TREND_LABEL[asset.trend]}
                  </span>
                </li>
              ))}
            </ul>
          </ResourceState>
        </Panel>

        <Panel
          placeholder
          title="Detalhe do ativo"
          hint="Área reservada para a análise aprofundada."
        >
          <div className="slot">
            <p>
              Selecione um ativo para abrir indicadores, correlações e explicação
              da IA.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
