import "./formula.css";

/**
 * A formulação do otimizador, escrita como matemática e não como bloco de código.
 *
 * Era um `<pre>` monoespaçado: legível, mas com o Σ do tamanho de uma letra e os
 * índices em caracteres unicode sobrescritos, que quebram em fontes diferentes.
 * Aqui o somatório tem limites em cima e embaixo, os índices são `<sub>` de
 * verdade, e cada termo carrega cor pelo PAPEL que exerce -- o que transforma a
 * figura numa explicação em vez de uma citação:
 *
 *   azul   = o que o solver decide     (x_i)
 *   neutro = entrada fixa do pedido    (gas_used, N)
 *   âmbar  = o que vem de previsão     (custo_i) -- e é o elo fraco do modelo
 *
 * Sem KaTeX: é uma expressão só, e a biblioteca custaria mais que o CSS.
 */

export interface ValoresDaFormula {
  /** N -- transações a executar. */
  nTransacoes: number;
  gasUsed: number;
  teto: number;
  janelas: number;
}

export function FormulaObjetivo({ valores }: { valores?: ValoresDaFormula }) {
  const M = valores ? String(valores.janelas - 1) : "M−1";
  const gas = valores ? valores.gasUsed.toLocaleString("pt-BR") : "gas_used";
  const n = valores ? String(valores.nTransacoes) : "N";
  const teto = valores ? String(valores.teto) : "teto";

  return (
    <div className="formulacao">
      <div className="objetivo">
        <span className="objetivo__rotulo">minimizar</span>

        <span className="expressao">
          <Somatorio cima={M} />
          <span className="termo termo--decisao">
            x<sub>i</sub>
          </span>
          <span className="op">·</span>
          <span className="termo termo--dado">{gas}</span>
          <span className="op">·</span>
          <span className="termo termo--previsto">
            custo<sub>i</sub>
          </span>
        </span>
      </div>

      <ul className="legenda-termos">
        <li>
          <span className="ponto ponto--decisao" aria-hidden="true" />
          <strong>
            x<sub>i</sub>
          </strong>
          <span>quantas transações executar na janela i — inteiro, é o que o solver decide</span>
        </li>
        <li>
          <span className="ponto ponto--dado" aria-hidden="true" />
          <strong>{gas}</strong>
          <span>gas por transação, vindo do <code>eth_estimateGas</code> — constante no pedido</span>
        </li>
        <li>
          <span className="ponto ponto--previsto" aria-hidden="true" />
          <strong>
            custo<sub>i</sub>
          </strong>
          <span>preço previsto de gas naquela hora — a única parte estimada, e o elo fraco</span>
        </li>
      </ul>

      <div className="restricoes">
        <span className="restricoes__rotulo">sujeito a</span>
        <ul>
          <li>
            <span className="restricao">
              <Somatorio cima={M} compacto />
              <span className="termo termo--decisao">
                x<sub>i</sub>
              </span>
              <span className="op">=</span>
              <span className="termo termo--dado">{n}</span>
            </span>
            <span className="restricao__leitura">
              todas as {n} transações precisam sair dentro do prazo
            </span>
          </li>
          <li>
            <span className="restricao">
              <span className="termo termo--dado">0</span>
              <span className="op">≤</span>
              <span className="termo termo--decisao">
                x<sub>i</sub>
              </span>
              <span className="op">≤</span>
              <span className="termo termo--dado">{teto}</span>
            </span>
            <span className="restricao__leitura">
              nenhuma hora concentra mais que {valores ? `${teto} transações` : "o teto"} — é
              a trava contra erro de previsão
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Σ com limites, i = 0 embaixo e o índice da última janela em cima. */
function Somatorio({ cima, compacto = false }: { cima: string; compacto?: boolean }) {
  return (
    <span className={`somatorio${compacto ? " somatorio--compacto" : ""}`} aria-hidden="true">
      <span className="somatorio__cima">{cima}</span>
      <span className="somatorio__sigma">∑</span>
      <span className="somatorio__baixo">i = 0</span>
    </span>
  );
}
