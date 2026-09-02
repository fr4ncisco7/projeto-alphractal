import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Backdrop } from "../components/Backdrop";
import { FormulaObjetivo } from "../components/FormulaObjetivo";
import { Logo } from "../components/Logo";
import { apiRequest } from "../lib/api";
import { endpoints } from "../lib/endpoints";
import type { Saude } from "../types";
import "./landing.css";

/**
 * Apresentação do projeto, e porta de entrada do painel.
 *
 * Fica fora da `Abertura` de propósito: é a página que alguém abre para
 * entender o que é isto ANTES de subir contêiner nenhum, então precisa
 * funcionar com a stack inteira desligada. Todo dado dinâmico aqui é opcional.
 */
export function LandingPage() {
  const saude = useSaudeOpcional();

  return (
    <div className="landing">
      <Backdrop />

      <header className="landing__topo">
        <span className="landing__marca">
          <Logo size={34} />
          <strong>Fees Monitor</strong>
        </span>
        <Link className="botao botao--claro" to="/painel">Acessar o painel</Link>
      </header>

      <main className="landing__miolo">
        {/* ---------------- capa ---------------- */}
        <section className="capa">
          <p className="capa__acima">Inteli Blockchain × Alphractal · Nortech Labs</p>
          <h1 className="capa__titulo">
            O custo de executar na Ethereum, medido bloco a bloco.
          </h1>
          <p className="capa__texto">
            Um módulo de monitoramento de gas em tempo real para a aba <em>Fees</em> da
            Alphractal, com um otimizador que responde à pergunta que o gestor faz na hora
            de operar: <strong>executo agora ou espero?</strong>
          </p>

          <div className="capa__acoes">
            <Link className="botao botao--claro botao--grande" to="/painel">
              Acessar o painel
            </Link>
            <a className="botao botao--fantasma botao--grande" href="#como-funciona">
              Como funciona
            </a>
          </div>

          {saude && (
            <p className="capa__ativo">
              <span className="pulso pulso--on" aria-hidden="true" />
              {saude.blocos.toLocaleString("pt-BR")} blocos de mainnet capturados ·
              ingestão {saude.ingestao} · otimizador{" "}
              {saude.solver === "ok" ? "disponível" : "inalcançável"}
            </p>
          )}
        </section>

        {/* ---------------- problema ---------------- */}
        <section className="secao">
          <h2 className="secao__titulo">O problema</h2>
          <div className="grid grid--split">
            <div className="cartao">
              <h3>Média histórica não vê o pico</h3>
              <p>
                Hoje a sub-aba <em>Fees</em> se apoia em médias históricas estáticas. Isso
                cria um ponto cego em relação à volatilidade instantânea da mempool: no
                minuto em que o custo dispara, a estimativa continua olhando para o passado.
              </p>
            </div>
            <div className="cartao">
              <h3>E quem paga é a execução</h3>
              <p>
                Para uma mesa institucional, o resultado é risco operacional concreto:
                transação travada por estimativa baixa demais, ou custo excessivo por
                executar no meio de um pico que ninguém previu.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- como funciona ---------------- */}
        <section className="secao" id="como-funciona">
          <h2 className="secao__titulo">Como funciona</h2>
          <p className="secao__texto">
            Três fluxos independentes, cada um com seu próprio ritmo.
          </p>

          <ol className="fluxos">
            <Fluxo
              numero="1"
              titulo="Ingestão em tempo real"
              ritmo="contínuo · ~12 s"
              texto="Uma assinatura WebSocket com o nó Ethereum captura cada bloco novo — base fee, priority fee e ocupação. O backend agrega em janelas de 1 minuto e 1 hora e reparte o evento entre todas as telas abertas por SSE."
              nota="A conexão com o nó mora no backend, não no navegador: com N usuários conectando direto seriam N assinaturas na mesma chave de RPC, e a chave ficaria exposta no frontend."
            />
            <Fluxo
              numero="2"
              titulo="Otimizador de execução"
              ritmo="sob demanda"
              texto="Você informa quantas transações precisa executar e até quando. Um estimador projeta o custo de cada hora do horizonte, e um MILP distribui as transações pelas janelas mais baratas — respeitando um teto por janela que limita a exposição a erro de previsão."
              nota="Se o plano distribuído sair mais caro que executar tudo agora, o solver devolve o baseline. Usar o otimizador nunca sai pior que não usá-lo."
            />
            <Fluxo
              numero="3"
              titulo="Backtest histórico"
              ritmo="offline"
              texto="O plano nasce da previsão e é cobrado pelo preço real que veio depois, sobre um corpus congelado de mainnet. É o que separa a economia que o modelo promete da que ele entrega."
              nota="Roda na integração contínua com um piso: se uma mudança fizer o otimizador voltar a perder dinheiro, o build falha."
            />
          </ol>
        </section>

        {/* ---------------- formulação ---------------- */}
        <section className="secao">
          <h2 className="secao__titulo">A formulação</h2>
          <p className="secao__texto">
            O otimizador resolve um problema de programação inteira mista. Cada cor abaixo
            marca um papel diferente na conta.
          </p>

          <div className="formulacao-caixa">
            <FormulaObjetivo />
          </div>

          <div className="grid grid--split">
            <div className="cartao">
              <h3>Por que inteiro, e não contínuo</h3>
              <p>
                <code>xᵢ</code> conta transações, e meia transação não existe. Um LP
                contínuo devolveria 7,4 transações numa janela — um número que ninguém
                consegue executar. Resolvido com <code>scipy.optimize.milp</code>.
              </p>
            </div>
            <div className="cartao">
              <h3>O estimador de custo</h3>
              <p>
                Fator de dia da semana primeiro, direto das médias diárias; a série é
                dividida por ele e só então entra o Holt-Winters sazonal de 24 h.
              </p>
              <p className="cartao__nota">
                A ordem importa: tirar o fator de dia do resíduo do Holt-Winters foi testado
                e falhou — o nível absorve a queda de fim de semana antes de ela chegar ao
                resíduo. Custava ~51% de precisão em horizontes de 48 h ou mais.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- arquitetura ---------------- */}
        <section className="secao">
          <h2 className="secao__titulo">Arquitetura</h2>
          <div className="servicos">
            <Servico nome="frontend" stack="React · Vite · TypeScript"
                     texto="Painel em tempo real, análise histórica e a tela do otimizador." />
            <Servico nome="backend-node" stack="Node · Express · viem"
                     texto="Ingestão pelo nó, agregação, SSE e orquestração do solver." />
            <Servico nome="solver" stack="Python · FastAPI · SciPy"
                     texto="Estimador e MILP. Não fala com o banco: recebe a série no pedido." />
            <Servico nome="db" stack="TimescaleDB"
                     texto="Hypertable por bloco e agregações contínuas de 1 min e 1 h." />
          </div>
          <p className="secao__nota">
            Tudo em <code>docker compose up</code>. O solver é um serviço separado porque
            Node não roda <code>statsmodels</code> — e mantê-lo sem acesso ao banco o deixa
            testável sem infraestrutura nenhuma.
          </p>
        </section>

        {/* ---------------- resultados ---------------- */}
        <section className="secao">
          <h2 className="secao__titulo">O que já está medido</h2>
          <div className="grid grid--metrics">
            <Medida valor="120 h" rotulo="corpus contíguo de mainnet"
                    nota="capturado bloco a bloco, sem buracos" />
            <Medida valor="+1,9%" rotulo="economia agregada em 12 h"
                    nota="realizada, não prevista — 49 origens de backtest" />
            <Medida valor="+45,4%" rotulo="o que a previsão perfeita acharia"
                    nota="mesmo MILP, mesmos limites, custos reais" />
            <Medida valor="141" rotulo="testes automatizados"
                    nota="99 no solver, 42 no backend" />
          </div>
          <p className="secao__nota">
            A distância entre <strong>+1,9%</strong> e <strong>+45,4%</strong> é erro de
            previsão, e é o gargalo conhecido do projeto: o estimador foi desenhado para ~4
            semanas de histórico e roda hoje com menos de uma. O número honesto de hoje é
            que o otimizador não perde dinheiro — não que ele já entregue o ganho possível.
          </p>
        </section>

        {/* ---------------- escopo ---------------- */}
        <section className="secao">
          <h2 className="secao__titulo">O que este módulo não faz</h2>
          <ul className="limites">
            <li>Não executa, assina nem automatiza transação on-chain — é estritamente leitura e análise.</li>
            <li>Não substitui sistemas da Alphractal nem vai para produção nesta entrega.</li>
            <li>Não consome gas real: nada aqui gasta ETH.</li>
            <li>Não dá recomendação de investimento — o que ele estima é custo de execução.</li>
          </ul>
        </section>

        <section className="fechamento">
          <h2>O painel está rodando ao lado.</h2>
          <p>Gas ao vivo, o padrão por hora do dia e o otimizador com a justificativa de cada janela.</p>
          <Link className="botao botao--claro botao--grande" to="/painel">Acessar o painel</Link>
        </section>
      </main>

      <footer className="landing__rodape">
        <span>Inteli Blockchain × Alphractal (Nortech Labs)</span>
        <span>Protótipo acadêmico · MIT</span>
      </footer>
    </div>
  );
}

/**
 * Estado do sistema, se ele responder.
 *
 * Silencioso na falha por desenho: a landing precisa abrir com a stack
 * desligada, e um erro de rede aqui não pode virar mensagem na tela de quem só
 * queria ler o que o projeto faz.
 */
function useSaudeOpcional(): Saude | null {
  const [saude, setSaude] = useState<Saude | null>(null);

  useEffect(() => {
    let ativo = true;
    const controlador = new AbortController();
    void apiRequest<Saude>(endpoints.saude, { signal: controlador.signal })
      .then((s) => ativo && setSaude(s))
      .catch(() => {});
    return () => {
      ativo = false;
      controlador.abort();
    };
  }, []);

  return saude;
}

function Fluxo({ numero, titulo, ritmo, texto, nota }: {
  numero: string; titulo: string; ritmo: string; texto: string; nota: string;
}) {
  return (
    <li className="fluxo">
      <span className="fluxo__numero" aria-hidden="true">{numero}</span>
      <div>
        <h3 className="fluxo__titulo">
          {titulo} <span className="fluxo__ritmo">{ritmo}</span>
        </h3>
        <p>{texto}</p>
        <p className="fluxo__nota">{nota}</p>
      </div>
    </li>
  );
}

function Servico({ nome, stack, texto }: { nome: string; stack: string; texto: string }) {
  return (
    <article className="servico">
      <code className="servico__nome">{nome}</code>
      <p className="servico__stack">{stack}</p>
      <p className="servico__texto">{texto}</p>
    </article>
  );
}

function Medida({ valor, rotulo, nota }: { valor: string; rotulo: string; nota: string }) {
  return (
    <article className="medida">
      <p className="medida__valor">{valor}</p>
      <p className="medida__rotulo">{rotulo}</p>
      <p className="medida__nota">{nota}</p>
    </article>
  );
}
