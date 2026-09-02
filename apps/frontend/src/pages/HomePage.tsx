import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ResourceState } from "../components/ResourceState";
import { useResource } from "../hooks/useResource";
import { useStreamBlocos } from "../hooks/useStreamBlocos";
import { apiRequest } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import { ApiError } from "../lib/errors";
import { dataHora, desde, gwei, percentual, usd } from "../lib/formato";
import type { EstatisticasDia, Otimizacao, Saude, SerieRecente } from "../types";
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

/** Transferência simples de ETH. */
const GAS_TRANSFERENCIA = 21_000;
/** Swap numa DEX. Ordem de grandeza típica, para dar uma segunda escala. */
const GAS_SWAP = 150_000;

/** Pedido usado no resumo do otimizador desta tela. */
const PEDIDO_VITRINE = { n_transacoes: 50, horas_ate_deadline: 24, gas_used: GAS_TRANSFERENCIA };

export function HomePage() {
  const estatisticas = useResource<EstatisticasDia>(endpoints.gasEstatisticas);
  const saude = useResource<Saude>(endpoints.saude);
  // 3 h de histórico: o suficiente para o gráfico ter forma sem carregar
  // milhares de pontos que ninguém enxergaria na largura do painel.
  const recente = useResource<SerieRecente>(`${endpoints.gasRecente}?minutos=180`);
  const stream = useStreamBlocos();
  const plano = usePlanoVitrine();

  const e = estatisticas.data;

  /**
   * Preço do último bloco -- o número que muda enquanto a tela está aberta.
   *
   * Vem do SSE quando já chegou um bloco; até lá, do último ponto da série
   * carregada, para o topo da página nunca abrir vazio esperando 12 s.
   */
  const precoAgora =
    stream.ultimo?.preco_gwei ?? recente.data?.serie.at(-1)?.media_gwei ?? null;

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
        <Destaque
          precoAgora={precoAgora}
          medianaDoDia={e?.mediana_gwei ?? null}
          usdPorEth={e?.usd_por_eth ?? null}
          conectado={stream.conectado}
          recebidos={stream.recebidos}
          bloco={stream.ultimo?.block_number ?? null}
        />

        <Panel
          title="Últimas 3 horas"
          hint="Média por minuto, atualizada a cada bloco"
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

        {/* As estatísticas do dia descem para depois do gráfico: são contexto,
            não a leitura principal. Uma faixa só -- em três grids separados as
            colunas de cada linha eram calculadas em separado e não alinhavam. */}
        <ResourceState
          loading={estatisticas.loading}
          error={estatisticas.error}
          onRetry={estatisticas.reload}
          skeletonRows={2}
          empty={e?.blocos === 0}
          emptyLabel="Nenhum bloco capturado hoje ainda."
        >
          <section className="faixa" aria-label="Estatísticas do dia">
            <Estatistica rotulo="Média" valor={gwei(e?.media_gwei)} unidade="gwei" />
            <Estatistica rotulo="Mediana" valor={gwei(e?.mediana_gwei)} unidade="gwei" />
            <Estatistica rotulo="Moda" valor={gwei(e?.moda_gwei)} unidade="gwei" />
            <Estatistica rotulo="Mínimo" valor={gwei(e?.minimo_gwei)} unidade="gwei" />
            <Estatistica rotulo="Máximo" valor={gwei(e?.maximo_gwei)} unidade="gwei" />
            <Estatistica
              rotulo="Congestionamento"
              valor={percentual((e?.congestionamento_medio ?? 0) * 100)}
            />
            <Estatistica
              rotulo="Blocos hoje"
              valor={(e?.blocos ?? 0).toLocaleString("pt-BR")}
              nota={`desde ${dataHora(e?.desde)}`}
            />
          </section>
        </ResourceState>

        <PlanoVitrine plano={plano.data} erro={plano.erro} carregando={plano.carregando} />

        <Panel title="Estado da coleta" hint="De onde vêm os números acima">
          <ResourceState
            loading={saude.loading}
            error={saude.error}
            onRetry={saude.reload}
            skeletonRows={2}
          >
            {/* Quatro colunas, e não quatro linhas: em linha, o rótulo e o
                estado ficavam separados por 1.200 px de vazio. */}
            <section className="faixa faixa--quatro">
              <Sinal rotulo="Ingestão ao vivo"
                     valor={saude.data?.ingestao === "ativa" ? "ativa" : "desligada"}
                     alerta={saude.data?.ingestao !== "ativa"} />
              <Sinal rotulo="Último bloco"
                     valor={desde(saude.data?.ultimo_bloco_em)}
                     // Acima de 5 min sem bloco, algo está errado: a rede
                     // produz um a cada ~12 segundos.
                     alerta={(saude.data?.defasagem_minutos ?? 0) > 5} />
              <Sinal rotulo="Blocos armazenados"
                     valor={(saude.data?.blocos ?? 0).toLocaleString("pt-BR")} />
              <Sinal rotulo="Otimizador"
                     valor={saude.data?.solver === "ok" ? "disponível" : "inalcançável"}
                     alerta={saude.data?.solver !== "ok"} />
            </section>
          </ResourceState>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Destaque: a leitura principal da tela
// ---------------------------------------------------------------------------

/**
 * gwei é o número grande porque é a unidade em que o preço se move e a que o
 * público do painel lê de imediato. O dólar aparece ao lado em três escalas
 * porque, com a rede barata como está hoje, uma transferência isolada custa
 * US$ 0,003 -- um número que lê como zero e esconde justamente o que o projeto
 * quer mostrar. Cem transferências já dão um valor que se segura na mão.
 */
function Destaque({
  precoAgora, medianaDoDia, usdPorEth, conectado, recebidos, bloco,
}: {
  precoAgora: number | null;
  medianaDoDia: number | null;
  usdPorEth: number | null;
  conectado: boolean;
  recebidos: number;
  bloco: number | null;
}) {
  const v = veredito(precoAgora, medianaDoDia);

  return (
    <section className="destaque">
      <div className="destaque__principal">
        <p className="destaque__rotulo">Preço efetivo agora</p>
        <p className="destaque__valor">
          {gwei(precoAgora)}
          <span className="destaque__unidade">gwei</span>
        </p>
        {v && <p className={`veredito veredito--${v.tom}`}>{v.texto}</p>}
        <p className="destaque__meta">
          <span className={`pulso pulso--${conectado ? "on" : "off"}`} aria-hidden="true" />
          {conectado
            ? `ao vivo · ${recebidos} bloco${recebidos === 1 ? "" : "s"}${bloco ? ` · #${bloco.toLocaleString("pt-BR")}` : ""}`
            : "desconectado do stream"}
        </p>
      </div>

      <div className="destaque__precos">
        <Preco nome="Uma transferência" gas={GAS_TRANSFERENCIA} preco={precoAgora} usdPorEth={usdPorEth} />
        <Preco nome="Um swap" gas={GAS_SWAP} preco={precoAgora} usdPorEth={usdPorEth} />
        <Preco nome="100 transferências" gas={GAS_TRANSFERENCIA * 100} preco={precoAgora} usdPorEth={usdPorEth} />
        <p className="destaque__base">
          {usdPorEth
            ? `${GAS_TRANSFERENCIA.toLocaleString("pt-BR")} de gas por transferência · ETH a ${usd(usdPorEth)}`
            : "cotação ETH/USD indisponível — os valores acima ficam em gwei"}
        </p>
      </div>
    </section>
  );
}

function Preco({ nome, gas, preco, usdPorEth }: {
  nome: string; gas: number; preco: number | null; usdPorEth: number | null;
}) {
  const valor =
    preco !== null && usdPorEth ? preco * 1e-9 * gas * usdPorEth : null;
  return (
    <div className="preco">
      <span className="preco__nome">{nome}</span>
      <strong className="preco__valor">{usd(valor)}</strong>
    </div>
  );
}

/**
 * Compara o preço do momento com a mediana do dia.
 *
 * A mediana é a referência certa aqui: ela não é puxada pelos picos raros que
 * fazem a média do dia mentir sobre o que é "normal". A faixa morta de 5% evita
 * o painel alternar entre "barato" e "caro" a cada bloco quando os dois valores
 * estão praticamente empatados.
 */
function veredito(preco: number | null, mediana: number | null) {
  if (preco === null || mediana === null || mediana <= 0) return null;
  const variacao = ((preco - mediana) / mediana) * 100;
  if (variacao <= -5) {
    return { tom: "barato", texto: `${percentual(Math.abs(variacao), 0)} abaixo da mediana do dia` };
  }
  if (variacao >= 5) {
    return { tom: "caro", texto: `${percentual(variacao, 0)} acima da mediana do dia` };
  }
  return { tom: "neutro", texto: "em linha com a mediana do dia" };
}

// ---------------------------------------------------------------------------
// Resumo do otimizador
// ---------------------------------------------------------------------------

/**
 * Calcula um plano de vitrine assim que a tela abre.
 *
 * O otimizador é o produto do projeto e ficava escondido atrás de um formulário
 * numa terceira aba. Aqui ele roda com um pedido fixo só para mostrar o que
 * sabe fazer; quem quiser os próprios números clica para a tela cheia.
 */
function usePlanoVitrine() {
  const [data, setData] = useState<Otimizacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const r = await apiRequest<Otimizacao>(endpoints.otimizar, {
          method: "POST",
          body: PEDIDO_VITRINE,
        });
        if (ativo) setData(r);
      } catch (causa) {
        // A trava de defasagem responde 422 com explicação em português; é uma
        // resposta legítima, não uma falha da tela.
        if (ativo) {
          setErro(causa instanceof ApiError ? causa.message : "Não foi possível calcular o plano.");
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
  }, []);

  return { data, erro, carregando };
}

function PlanoVitrine({ plano, erro, carregando }: {
  plano: Otimizacao | null; erro: string | null; carregando: boolean;
}) {
  const titulo = `Se você tivesse ${PEDIDO_VITRINE.n_transacoes} transferências para fazer hoje`;
  // Derivado do pedido, e não escrito à mão: mexer na constante sem mexer
  // no texto deixaria o painel descrevendo um prazo que não foi pedido.
  const dica = `Distribuídas nas próximas ${PEDIDO_VITRINE.horas_ate_deadline} h pelo otimizador`;

  if (carregando) {
    return (
      <Panel title={titulo} hint={dica}>
        <div className="skeleton"><div className="skeleton__row" /></div>
      </Panel>
    );
  }

  if (erro || !plano) {
    return (
      <Panel title={titulo} hint={dica}>
        <p className="statebox statebox--error" role="status">{erro}</p>
      </Panel>
    );
  }

  const janelas = plano.plano.filter((j) => j.x > 0);
  // A recomendação vem do solver, não de inferir pelo sinal do percentual: com
  // a trava de dominância a economia é 0 nos dois casos de "não distribua"
  // (empate e plano descartado), e só o campo distingue os dois.
  const distribuir = !plano.executar_agora && plano.economia_pct > 0;
  // Quanto o plano descartado sairia pior que executar tudo agora.
  const quantoPior =
    plano.custo_baseline_t0_gwei > 0
      ? (plano.custo_distribuido_gwei / plano.custo_baseline_t0_gwei - 1) * 100
      : 0;
  /**
   * Escala da fita.
   *
   * Era o teto por janela, o que funcionava enquanto todo x_i o respeitava.
   * Com a trava de dominância o plano devolvido pode ser "tudo agora", e aí
   * x_0 = N > teto: a barra ia a 200% da altura e vazava por cima do painel.
   */
  const escalaDaFita = Math.max(
    plano.teto_por_janela,
    ...plano.plano.map((j) => j.x),
  );

  return (
    <Panel
      title={titulo}
      hint={dica}
      actions={<Link className="statebox__retry" to="/painel/predicoes">Abrir otimizador</Link>}
    >
      <div className="resumo">
        {/* Economia negativa NÃO é economia: é o quanto o plano custaria a MAIS
            que executar tudo agora. Mostrar o módulo dela ao lado de "a hora
            atual já é a melhor" fazia uma penalidade de 133% parecer um ganho
            de 133%. Quando o número é negativo a manchete passa a ser a
            recomendação -- que é a saída real do modelo -- e o percentual desce
            para nota, com o sinal e o sentido escritos. */}
        <div className="resumo__numero">
          {distribuir ? (
            <>
              <p className="resumo__valor resumo__valor--bom">
                {percentual(plano.economia_pct, 1)}
              </p>
              <p className="resumo__legenda">mais barato que executar tudo agora</p>
              {plano.economia_usd !== null && (
                <p className="resumo__nota">
                  {usd(plano.custo_total_usd)} contra {usd(plano.custo_baseline_t0_usd)} —
                  economia de {usd(plano.economia_usd)}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="resumo__valor resumo__valor--agora">Execute agora</p>
              <p className="resumo__legenda">
                A hora atual já é a mais barata prevista no prazo.
              </p>
              {plano.executar_agora && (
                <p className="resumo__nota">
                  O otimizador chegou a montar uma distribuição, mas ela custaria{" "}
                  {percentual(quantoPior, 1)} a mais ({usd(plano.custo_distribuido_usd)}{" "}
                  contra {usd(plano.custo_baseline_t0_usd)}) — o teto de{" "}
                  {plano.teto_por_janela} transações por janela impede concentrar tudo
                  numa hora só, então ela foi descartada.
                </p>
              )}
            </>
          )}
        </div>

        {/* Fita de 24 janelas: mostra a FORMA da recomendação de uma vez, em vez
            de uma lista que exige ler hora por hora. */}
        <div className="fita">
          <div className="fita__barras" role="img"
               aria-label={`Distribuição em ${janelas.length} das ${plano.n_janelas} janelas`}>
            {plano.plano.map((j) => (
              <span
                key={j.janela}
                className={`fita__janela${j.x > 0 ? " fita__janela--usada" : ""}`}
                style={{ "--altura": `${(j.x / escalaDaFita) * 100}%` } as React.CSSProperties}
                title={`${j.janela === 0 ? "agora" : `+${j.janela}h`}: ${j.x} tx a ${gwei(j.custo_i_gwei)} gwei/gas`}
              />
            ))}
          </div>
          <p className="fita__eixo">
            <span>agora</span>
            <span>{janelas.length} janelas usadas · teto de {plano.teto_por_janela}</span>
            <span>+{plano.n_janelas - 1}h</span>
          </p>
        </div>
      </div>

      {plano.aviso && <p className="metric__hint" role="status">⚠ {plano.aviso}</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Estatistica({ rotulo, valor, unidade, nota }: {
  rotulo: string; valor: string; unidade?: string; nota?: string;
}) {
  return (
    <article className="faixa__item">
      <p className="faixa__rotulo">{rotulo}</p>
      <p className="faixa__valor">
        {valor}
        {unidade && <span className="faixa__unidade"> {unidade}</span>}
      </p>
      {nota && <p className="faixa__nota">{nota}</p>}
    </article>
  );
}

function Sinal({ rotulo, valor, alerta = false }: {
  rotulo: string; valor: string; alerta?: boolean;
}) {
  return (
    <article className="faixa__item">
      <p className="faixa__rotulo">{rotulo}</p>
      <p className="faixa__valor">
        <span className={`pulso pulso--${alerta ? "off" : "on"}`} aria-hidden="true" />
        {valor}
      </p>
    </article>
  );
}
