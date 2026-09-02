import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { apiRequest } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import { ApiError } from "../lib/errors";
import { gwei, percentual, usd } from "../lib/formato";
import type { Otimizacao } from "../types";
import "./pages.css";

/** Transferência simples de ETH. O valor mais comum e um padrão seguro. */
const GAS_USED_PADRAO = 21_000;

export function PredictionsPage() {
  const [nTransacoes, setNTransacoes] = useState("50");
  const [horas, setHoras] = useState("24");
  const [gasUsed, setGasUsed] = useState(String(GAS_USED_PADRAO));

  const [resultado, setResultado] = useState<Otimizacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function otimizar(evento: React.FormEvent) {
    evento.preventDefault();
    setCarregando(true);
    setErro(null);

    try {
      const resposta = await apiRequest<Otimizacao>(endpoints.otimizar, {
        method: "POST",
        body: {
          n_transacoes: Number(nTransacoes),
          horas_ate_deadline: Number(horas),
          gas_used: Number(gasUsed),
        },
      });
      setResultado(resposta);
    } catch (causa) {
      // O backend explica o problema em português e às vezes traz a saída
      // prática junto (histórico defasado, histórico insuficiente). O api.ts
      // já junta `erro` com `como_resolver`.
      setErro(causa instanceof ApiError ? causa.message : "Não foi possível calcular o plano.");
      setResultado(null);
    } finally {
      setCarregando(false);
    }
  }

  const janelasComTransacoes = resultado?.plano.filter((j) => j.x > 0) ?? [];

  return (
    <>
      <PageHeader
        title="Otimizador de execução"
        description="Distribui N transações ao longo do prazo, buscando as janelas mais baratas."
      />

      <div className="grid grid--split">
        <Panel title="Parâmetros" hint="O que você precisa executar, e até quando">
          <form className="stack" onSubmit={otimizar}>
            <Campo
              rotulo="Transações a executar"
              valor={nTransacoes}
              onChange={setNTransacoes}
              tipo="number"
              min="1"
              ajuda="Quantas transações precisam ser enviadas."
            />
            <Campo
              rotulo="Prazo (horas)"
              valor={horas}
              onChange={setHoras}
              tipo="number"
              min="1"
              step="0.5"
              ajuda="Truncado para baixo: 5,5 h vira 5 janelas, nunca 6 — para nunca recomendar depois do prazo."
            />
            <Campo
              rotulo="Gas por transação"
              valor={gasUsed}
              onChange={setGasUsed}
              tipo="number"
              min="1"
              ajuda={`${GAS_USED_PADRAO.toLocaleString("pt-BR")} é uma transferência simples de ETH.`}
            />
            <button type="submit" className="btn btn--light" disabled={carregando}>
              {carregando ? "Calculando…" : "Calcular plano"}
            </button>
          </form>

          {erro && (
            <p className="statebox__error" role="alert">
              {erro}
            </p>
          )}
        </Panel>

        <div className="stack">
          {!resultado && !erro && (
            <Panel placeholder title="Plano recomendado">
              <div className="slot">
                <p>Informe os parâmetros ao lado para calcular a distribuição.</p>
              </div>
            </Panel>
          )}

          {resultado && (
            <>
              <Panel
                title={resultado.economia_pct > 0 ? "Economia" : "Executar agora sai mais barato"}
                hint={`Comparado a executar as ${resultado.plano.reduce((t, j) => t + j.x, 0)} transações agora`}
              >
                <div className="grid grid--metrics">
                  <article className="metric">
                    {/* O rótulo acompanha o sinal: "Economia: -US$ 0,39" obriga
                        o leitor a decifrar que o negativo inverte o sentido da
                        palavra. Com o valor negativo isto não é economia
                        nenhuma -- é o custo extra de distribuir. */}
                    <p className="metric__label">
                      {resultado.economia_pct > 0 ? "Economia" : "Custo extra de distribuir"}
                    </p>
                    {/* Dólar em cima do percentual: é o número que decide. */}
                    <p className="metric__value">
                      {resultado.economia_usd !== null
                        ? usd(Math.abs(resultado.economia_usd))
                        : percentual(Math.abs(resultado.economia_pct), 2)}
                    </p>
                    <p className="metric__hint">
                      {resultado.economia_usd !== null &&
                        `${percentual(Math.abs(resultado.economia_pct), 2)} · `}
                      {resultado.economia_pct > 0
                        ? "custo evitado ao distribuir a execução"
                        : "a hora atual já é a mais barata prevista — o modelo está dizendo para executar agora"}
                    </p>
                  </article>
                  <article className="metric">
                    <p className="metric__label">Custo do plano</p>
                    <p className="metric__value">
                      {resultado.custo_total_usd !== null
                        ? usd(resultado.custo_total_usd)
                        : gwei(resultado.custo_total_gwei)}
                    </p>
                    <p className="metric__hint">{gwei(resultado.custo_total_gwei)} gwei</p>
                  </article>
                  <article className="metric">
                    <p className="metric__label">Executando agora</p>
                    <p className="metric__value">
                      {resultado.custo_baseline_t0_usd !== null
                        ? usd(resultado.custo_baseline_t0_usd)
                        : gwei(resultado.custo_baseline_t0_gwei)}
                    </p>
                    <p className="metric__hint">{gwei(resultado.custo_baseline_t0_gwei)} gwei, tudo de uma vez</p>
                  </article>
                </div>

                {resultado.economia_pct < 0 && (
                  <p className="metric__hint">
                    Economia negativa não é erro: o teto de {resultado.teto_por_janela}{" "}
                    transações por janela é uma proteção contra erro de previsão, e
                    quando a hora atual já é a melhor ele obriga a espalhar para
                    janelas piores.
                  </p>
                )}

                {resultado.aviso && (
                  <p className="metric__hint" role="status">
                    ⚠ {resultado.aviso}
                  </p>
                )}
              </Panel>

              <Panel
                title="Quando executar"
                hint={`${janelasComTransacoes.length} de ${resultado.n_janelas} janelas · teto de ${resultado.teto_por_janela} por janela`}
              >
                <ul className="rows">
                  {janelasComTransacoes.map((j) => (
                    <li key={j.janela} className="row">
                      <span className="row__ticker">
                        {j.janela === 0 ? "agora" : `+${j.janela}h`}
                      </span>
                      <span className="row__meter" aria-hidden="true">
                        <span
                          className="row__meter-fill"
                          style={{ width: `${(j.x / resultado.teto_por_janela) * 100}%` }}
                        />
                      </span>
                      <span className="row__value">{j.x} tx</span>
                      <span className="row__name">{gwei(j.custo_i_gwei)} gwei/gas</span>
                    </li>
                  ))}
                </ul>
                <p className="metric__hint">
                  Histórico usado: {resultado.historico_horas} h.
                </p>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Campo({ rotulo, valor, onChange, ajuda, ...resto }: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  ajuda: string;
  tipo?: string;
  min?: string;
  step?: string;
}) {
  const { tipo = "text", ...atributos } = resto;
  return (
    <label className="campo">
      <span className="campo__rotulo">{rotulo}</span>
      <input
        className="campo__entrada"
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        {...atributos}
      />
      <span className="campo__ajuda">{ajuda}</span>
    </label>
  );
}
