import { NavLink, Outlet } from "react-router-dom";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import "./AppShell.css";

const navigation = [
  { to: "/", label: "Tela Inicial" },
  { to: "/analise", label: "Análise" },
  { to: "/predicoes", label: "Solver" },
];

export function AppShell() {
  return (
    <div className="app">
      <Backdrop variant="app" />

      <aside className="sidebar">
        <NavLink to="/" className="sidebar__brand" aria-label="Alphractal">
          <Logo size={68} />
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
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Sem login não há usuário para identificar aqui, e um cartão com nome
            e plano inventados seria pior que nada na frente do parceiro. Quando
            o módulo entrar na plataforma, este canto é da casca da Alphractal.
            O estado ao vivo do sistema tem lugar próprio: o pulso do destaque
            na tela inicial e o painel "Estado da coleta". */}
        <div className="sidebar__footer">
          <p className="modulo">
            <strong>Fees Monitor</strong>
            <small>Inteli Blockchain × Alphractal</small>
          </p>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
