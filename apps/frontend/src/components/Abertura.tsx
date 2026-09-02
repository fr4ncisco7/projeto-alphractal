import { useEffect, useState, type ReactNode } from "react";
import { useProntidao, type Verificacao } from "../hooks/useProntidao";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import "./Abertura.css";

/** Segmentos da barra. Ecoa a fita de janelas do painel -- mesma linguagem. */
const SEGMENTOS = 28;
/** Duração do fade de saída. Precisa bater com a transição em Abertura.css. */
const SAIDA_MS = 420;

/**
 * Porta de entrada da aplicação, no lugar da tela de login.
 *
 * O painel é um módulo da plataforma da Alphractal: quem chega aqui já passou
 * pela autenticação deles, então uma tela de login própria seria uma cerimônia
 * falsa. O que faz falta na abertura é outra coisa -- saber se o backend, o nó
 * e o banco estão de pé antes de o painel aparecer com caixas de erro.
 *
 * O painel monta assim que o `/health` responde, por baixo desta tela: as
 * requisições dele correm durante o tempo mínimo de exibição, em vez de
 * começarem só depois. Quando a abertura sai, o conteúdo já está desenhado.
 */
export function Abertura({ children }: { children: ReactNode }) {
  const prontidao = useProntidao();
  const [saindo, setSaindo] = useState(false);
  const [encerrada, setEncerrada] = useState(false);

  useEffect(() => {
    if (!prontidao.pronto) return;
    setSaindo(true);
    const t = setTimeout(() => setEncerrada(true), SAIDA_MS);
    return () => clearTimeout(t);
  }, [prontidao.pronto]);

  // Uma nova tentativa depois de uma falha traz a tela de volta ao início.
  useEffect(() => {
    if (prontidao.bloqueado) {
      setSaindo(false);
      setEncerrada(false);
    }
  }, [prontidao.bloqueado]);

  return (
    <>
      {prontidao.podeMontar && children}

      {!encerrada && (
        <div className={`abertura${saindo ? " abertura--saindo" : ""}`} role="status" aria-live="polite">
          <Backdrop />

          <div className="abertura__miolo">
            <div className="abertura__marca">
              <Logo size={64} />
            </div>

            <h1 className="abertura__titulo">Fees Monitor</h1>
            <p className="abertura__assinatura">
              Alphractal · monitoramento de gas e otimização de execução
            </p>

            {/* Aceso em azul, o trilho completo diz "pronto" -- inclusive quando
                as três checagens falharam. A cor precisa seguir o desfecho. */}
            <div
              className={`trilho${prontidao.bloqueado ? " trilho--falhou" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(prontidao.progresso * 100)}
              aria-label="Preparando o painel"
            >
              {Array.from({ length: SEGMENTOS }, (_, i) => (
                <span
                  key={i}
                  className={`trilho__seg${
                    i < prontidao.progresso * SEGMENTOS ? " trilho__seg--aceso" : ""
                  }`}
                  // O acendimento em cascata dá direção ao movimento; sem ele
                  // os segmentos de uma checagem apareceriam todos de uma vez.
                  style={{ transitionDelay: `${(i % (SEGMENTOS / 3)) * 22}ms` }}
                />
              ))}
            </div>

            <ul className="checagens">
              {prontidao.verificacoes.map((v) => (
                <Checagem key={v.chave} verificacao={v} bloqueado={prontidao.bloqueado} />
              ))}
            </ul>

            {prontidao.bloqueado && (
              <div className="abertura__parede">
                <p>
                  O painel não abre sem o backend. Confira se os contêineres estão
                  de pé com <code>docker compose ps</code>.
                </p>
                <button type="button" className="abertura__retry" onClick={prontidao.tentarDeNovo}>
                  Tentar de novo
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Checagem({ verificacao, bloqueado }: {
  verificacao: Verificacao;
  bloqueado: boolean;
}) {
  const { estado, rotulo, detalhe, essencial } = verificacao;
  return (
    <li className={`checagem checagem--${estado}`}>
      <span className="checagem__sinal" aria-hidden="true">
        {estado === "ok" ? <Risco /> : estado === "falhou" ? "!" : <span className="checagem__giro" />}
      </span>
      <span className="checagem__rotulo">{rotulo}</span>
      <span className="checagem__detalhe">
        {detalhe ?? "verificando…"}
        {/* Uma falha não-essencial precisa dizer que o painel abre mesmo assim,
            senão o "!" laranja parece impedir a entrada. Mas não quando o
            backend caiu junto: aí o painel não abre, e a ressalva mentiria. */}
        {estado === "falhou" && !essencial && !bloqueado && " — o painel abre sem isso"}
      </span>
    </li>
  );
}

function Risco() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
         strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
