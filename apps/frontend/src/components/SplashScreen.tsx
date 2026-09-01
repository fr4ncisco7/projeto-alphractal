import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import "./ui.css";

/** Exibido enquanto a sessão salva é validada contra o backend. */
export function SplashScreen() {
  return (
    <div className="splash">
      <Backdrop />
      <div className="splash__mark">
        <Logo size={56} />
      </div>
      <p className="splash__label">Carregando sua sessão...</p>
    </div>
  );
}
