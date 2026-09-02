import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useHistoricoDeExecucoes } from "../hooks/useHistoricoDeExecucoes";
import { apiRequest } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import { ApiError } from "../lib/errors";
import { dataHora, gwei, horaCurta, percentual, usd } from "../lib/formato";
import type { JanelaPlano, Otimizacao } from "../types";
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
  const historico = useHistoricoDeExecucoes();

  async function otimizar(evento: React.FormEvent) {
    evento.preventDefault();
    setCarregando(true);
    setErro(null);

    const pedido = {
      n_transacoes: Number(nTransacoes),
      horas_ate_deadline: Number(horas),
      gas_used: Number(gasUsed),
    };

    try {
      const resposta = await apiRequest<Otimizacao>(endpoints.otimizar, {
        method: "POST",
        body: pedido,
      });
      setResultado(resposta);
      historico.registrar(pedido, resposta);
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
        {/* Formulário e histórico numa coluna só: filhos diretos de
            `.grid--split` viram colunas, e o histórico solto abria uma
            terceira. */}
        <div className="stack">
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

        {historico.execucoes.length > 0 && (
          <Panel
            title="Planos que você calculou"
            hint="Guardados neste navegador · clique para recarregar os parâmetros"
            actions={
              <button type="button" className="statebox__retry" onClick={historico.limpar}>
                Limpar
              </button>
            }
          >
            <ul className="execucoes">
              {historico.execucoes.map((e) => (
                <li key={e.em}>
                  <button
                    type="button"
                    className="execucao"
                    onClick={() => {
                      setNTransacoes(String(e.n_transacoes));
                      setHoras(String(e.horas_ate_deadline));
                      setGasUsed(String(e.gas_used));
                    }}
                  >
                    <span className="execucao__hora">{horaCurta(e.em)}</span>
                    <span className="execucao__params">
                      {e.n_transacoes} tx · {e.horas_ate_deadline} h ·{" "}
                      {(e.gas_used / 1000).toLocaleString("pt-BR")}k gas
                    </span>
                    <span
                      className={`tag tag--${e.executar_agora ? "neutro" : "up"}`}
                    >
                      {e.executar_agora
                        ? "executar agora"
                        : e.economia_usd !== null
                          ? `${percentual(e.economia_pct, 1)} · ${usd(e.economia_usd)}`
                          : percentual(e.economia_pct, 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        </div>

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
                title={resultado.executar_agora ? "Executar agora sai mais barato" : "Economia"}
                hint={`Comparado a executar as ${resultado.plano.reduce((t, j) => t + j.x, 0)} transações agora`}
              >
                <div className="grid grid--metrics">
                  <article className="metric">
                    <p className="metric__label">Economia</p>
                    {/* Dólar em cima do percentual: é o número que decide. */}
                    <p className="metric__value">
                      {resultado.economia_usd !== null
                        ? usd(resultado.economia_usd)
                        : percentual(resultado.economia_pct, 2)}
                    </p>
                    <p className="metric__hint">
                      {resultado.economia_usd !== null &&
                        `${percentual(resultado.economia_pct, 2)} · `}
                      {resultado.executar_agora
                        ? "a hora atual já é a mais barata prevista — o plano é executar tudo agora"
                        : resultado.economia_pct > 0
                          ? "custo evitado ao distribuir a execução"
                          : "distribuir empata com executar agora no prazo pedido"}
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

                {resultado.executar_agora && (
                  <p className="metric__hint">
                    O otimizador montou uma distribuição que custaria{" "}
                    {gwei(resultado.custo_distribuido_gwei)} gwei — mais que os{" "}
                    {gwei(resultado.custo_baseline_t0_gwei)} de executar tudo agora — e a
                    descartou. O teto de {resultado.teto_por_janela} transações por janela
                    protege contra erro de previsão, mas quando a hora atual já é a melhor
                    ele obriga a espalhar para janelas piores; nesse caso o plano devolvido
                    é o de executar imediatamente.
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

              <Panel
                title="Por que este plano"
                hint="Custo previsto de cada janela, e as que o otimizador escolheu"
              >
                <CurvaPrevista plano={resultado.plano} />
                <p className="metric__hint">
                  Previsão a partir de {resultado.historico_horas} h de histórico,
                  de {dataHora(resultado.historico_de)} a {dataHora(resultado.historico_ate)}.
                  A linha tracejada é o preço previsto para agora: só há o que ganhar
                  nas janelas abaixo dela.
                </p>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * A curva de custo previsto, com as janelas escolhidas destacadas.
 *
 * Desenhada com barras em CSS, e não com uma biblioteca de gráfico: são 24
 * valores discretos, é o mesmo idioma já usado na tela de Análise e na fita da
 * tela inicial, e evita carregar mais 170 kB numa tela que não tinha gráfico.
 *
 * A linha tracejada no custo da janela 0 é o que faz a figura explicar o plano:
 * ela marca o preço de executar agora, e o otimizador só tem o que ganhar nas
 * barras abaixo dela. Quando nenhuma barra fica abaixo, a trava de dominância
 * manda executar imediatamente -- e a figura mostra o porquê sem precisar de
 * texto.
 */
function CurvaPrevista({ plano }: { plano: JanelaPlano[] }) {
  const maximo = Math.max(...plano.map((j) => j.custo_i_gwei));
  const agora = plano[0]?.custo_i_gwei ?? 0;
  const escolhidas = plano.filter((j) => j.x > 0).length;

  if (!Number.isFinite(maximo) || maximo <= 0) return null;

  return (
    <>
      <div
        className="curva"
        style={{ "--nivel-agora": `${(agora / maximo) * 100}%` } as React.CSSProperties}
        role="img"
        aria-label={`Custo previsto em ${plano.length} janelas; ${escolhidas} escolhidas`}
      >
        {plano.map((j) => (
          <span
            key={j.janela}
            className={`curva__janela${j.x > 0 ? " curva__janela--escolhida" : ""}`}
            style={{ "--altura": `${(j.custo_i_gwei / maximo) * 100}%` } as React.CSSProperties}
            title={
              `${j.janela === 0 ? "agora" : `+${j.janela}h`}: ` +
              `${gwei(j.custo_i_gwei)} gwei/gas` +
              (j.x > 0 ? ` · ${j.x} transações aqui` : "")
            }
          />
        ))}
      </div>
      <p className="curva__eixo">
        <span>agora</span>
        <span className="curva__legenda">
          <i className="ponto ponto--escolhida" aria-hidden="true" /> escolhida
          <i className="ponto ponto--linha" aria-hidden="true" /> preço de agora
        </span>
        <span>+{plano.length - 1}h</span>
      </p>
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
