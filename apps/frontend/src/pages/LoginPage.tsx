import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Backdrop } from "../components/Backdrop";
import { Logo } from "../components/Logo";
import { ApiError } from "../lib/errors";
import "./LoginPage.css";

type Status = "idle" | "loading";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s()-]{8,}$/;

export function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";

  function validate() {
    const value = identifier.trim();
    if (!value) return "Informe seu e-mail ou telefone.";
    if (!EMAIL.test(value) && !PHONE.test(value))
      return "E-mail ou telefone inválido.";
    if (password.length < 6) return "A senha precisa ter ao menos 6 caracteres.";
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const problem = validate();
    setError(problem);
    if (problem) return;

    setStatus("loading");

    try {
      await signIn({ identifier: identifier.trim(), password });
      navigate(redirectTo, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Não foi possível entrar. Tente novamente.",
      );
      setStatus("idle");
    }
  }

  return (
    <div className="page">
      <Backdrop />

      <main className="shell">
        <section className="panel panel--brand">
          <div className="brand">
            <Logo />
            <span className="brand__word">Alphractal</span>
          </div>

          <div className="brand__rule" />

          <h1 className="headline">
            1,500+ <em>Crypto Metrics.</em>
            <br />
            One Platform. AI That
            <br />
            <em>Explains Them.</em>
          </h1>

          <div className="brand__actions">
            <a className="btn btn--ghost" href="https://alphractal.com">
              Go to our website
            </a>
            <a className="btn btn--light" href="#register">
              Create your account
            </a>
          </div>
        </section>

        <div className="divider" role="presentation" />

        <section className="panel panel--form">
          <header className="form__header">
            <h2 className="form__title">Login</h2>
            <p className="form__subtitle">Faça login para acessar a plataforma</p>
          </header>

          <form className="form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label className="field__label" htmlFor="identifier">
                Endereço de e-mail ou telefone
              </label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                placeholder="Endereço de e-mail ou telefone"
                value={identifier}
                aria-invalid={error !== null}
                aria-describedby="form-feedback"
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setError(null);
                }}
              />
            </div>

            <div className="field field--password">
              <label className="field__label" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                name="password"
                type={revealed ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Senha"
                value={password}
                aria-invalid={error !== null}
                aria-describedby="form-feedback"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
              />
              <button
                type="button"
                className="field__toggle"
                onClick={() => setRevealed((current) => !current)}
                aria-label={revealed ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={revealed}
              >
                <EyeIcon closed={revealed} />
              </button>
            </div>

            <p
              id="form-feedback"
              className={`form__feedback${error ? " form__feedback--error" : ""}`}
              role="status"
              aria-live="polite"
            >
              {error ?? ""}
            </p>

            <button
              type="submit"
              className="btn btn--light btn--block"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Entrando..." : "Logar"}
            </button>

            <a className="btn btn--ghost btn--block" href="#register">
              Register
            </a>
          </form>

          <p className="form__legal">
            Protegido por criptografia de ponta a ponta
          </p>
        </section>
      </main>
    </div>
  );
}

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {closed && <path d="M4 20 20 4" />}
    </svg>
  );
}
