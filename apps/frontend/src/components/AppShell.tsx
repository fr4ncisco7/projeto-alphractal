import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import "./AppShell.css";

const navigation = [
  { to: "/", label: "Tela Inicial" },
  { to: "/analise", label: "Análise" },
  { to: "/predicoes", label: "Solver" },
];

export function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="app">
      <Backdrop variant="app" />

      <aside className="sidebar">
        <NavLink to="/" className="sidebar__brand" aria-label="Alphractal">
          <Logo size={44} />
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

        <div className="sidebar__footer">
          <div className="usercard">
            <span className="usercard__avatar" aria-hidden="true">
              {initials(user?.name)}
            </span>
            <span className="usercard__info">
              <strong>{user?.name ?? "Conta"}</strong>
              <small>{user?.plan ?? "—"}</small>
            </span>
            <button
              type="button"
              className="usercard__exit"
              onClick={() => void signOut()}
              aria-label="Sair da conta"
              title="Sair"
            >
              <ExitIcon />
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function initials(name?: string) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function ExitIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}
