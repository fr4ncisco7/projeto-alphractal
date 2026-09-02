import { useCallback, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import "./AppShell.css";

/**
 * Preferência de barra recolhida, guardada no navegador.
 *
 * É preferência de quem usa, não estado da aplicação: quem recolheu a barra
 * espera encontrá-la recolhida na próxima visita, e não há nada aqui que
 * justifique ida ao servidor.
 */
const CHAVE_RECOLHIDA = "fees-monitor:barra-recolhida";

function lerPreferencia(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === "1";
  } catch {
    // Aba anônima com dados de site bloqueados: abre expandida.
    return false;
  }
}

const navigation = [
  { to: "/", label: "Tela Inicial", icone: <IconePulso /> },
  { to: "/analise", label: "Análise", icone: <IconeBarras /> },
  { to: "/predicoes", label: "Solver", icone: <IconeControles /> },
];

export function AppShell() {
  const [recolhida, setRecolhida] = useState(lerPreferencia);

  const alternar = useCallback(() => {
    setRecolhida((atual) => {
      const proxima = !atual;
      try {
        localStorage.setItem(CHAVE_RECOLHIDA, proxima ? "1" : "0");
      } catch {
        // A preferência vale só para esta sessão; a barra continua funcionando.
      }
      return proxima;
    });
  }, []);

  return (
    <div className={`app${recolhida ? " app--recolhida" : ""}`}>
      <Backdrop variant="app" />

      <aside className="sidebar">
        <NavLink to="/" className="sidebar__brand" aria-label="Alphractal">
          <Logo size={recolhida ? 38 : 68} />
        </NavLink>

        <nav className="sidebar__nav" aria-label="Navegação principal">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `navlink${isActive ? " navlink--active" : ""}`
              }
              // Com a barra recolhida o rótulo some da tela, mas não pode sumir
              // para quem navega por teclado ou leitor: `title` cobre o mouse,
              // `aria-label` cobre a tecnologia assistiva.
              title={recolhida ? item.label : undefined}
              aria-label={item.label}
            >
              <span className="navlink__icone" aria-hidden="true">{item.icone}</span>
              <span className="navlink__texto">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {/* Sem login não há usuário para identificar aqui. Quando o módulo
              entrar na plataforma, este canto é da casca da Alphractal. */}
          <p className="modulo">
            <strong>Fees Monitor</strong>
            <small>Inteli Blockchain × Alphractal</small>
          </p>

          <button
            type="button"
            className="recolher"
            onClick={alternar}
            title={recolhida ? "Expandir a barra" : "Recolher a barra"}
            aria-label={recolhida ? "Expandir a barra lateral" : "Recolher a barra lateral"}
            aria-expanded={!recolhida}
          >
            <span className="recolher__seta" aria-hidden="true"><IconeSeta /></span>
            <span className="navlink__texto">Recolher</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ícones
// ---------------------------------------------------------------------------
// Desenhados à mão em vez de instalar um pacote de ícones: são quatro traçados
// simples, e uma dependência inteira para isso pesaria mais que o SVG.
// Todos com o mesmo viewBox, traço e espessura, para alinharem na coluna.

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24" width="20" height="20" fill="none"
      stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Tela inicial: pulso, que é o que a tela mostra -- preço se movendo ao vivo. */
function IconePulso() {
  return <Svg><path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" /></Svg>;
}

/** Análise: barras, o padrão por hora do dia. */
function IconeBarras() {
  return (
    <Svg>
      <path d="M4 20V10" /><path d="M10 20V4" />
      <path d="M16 20v-7" /><path d="M21 20H3" />
    </Svg>
  );
}

/** Solver: controles, que é o que a tela faz -- ajustar e distribuir. */
function IconeControles() {
  return (
    <Svg>
      <path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" />
      <path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" />
      <path d="M4 18h8" /><path d="M16 18h4" /><circle cx="14" cy="18" r="2" />
    </Svg>
  );
}

function IconeSeta() {
  return <Svg><path d="M15 6l-6 6 6 6" /></Svg>;
}
