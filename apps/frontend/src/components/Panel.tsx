import type { ReactNode } from "react";
import "./ui.css";

type PanelProps = {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  /** Área reservada para uma funcionalidade futura ganha traço pontilhado. */
  placeholder?: boolean;
  children?: ReactNode;
};

export function Panel({
  title,
  hint,
  actions,
  placeholder = false,
  children,
}: PanelProps) {
  return (
    <section className={`panelbox${placeholder ? " panelbox--placeholder" : ""}`}>
      {(title || actions) && (
        <header className="panelbox__head">
          <div>
            {title && <h2 className="panelbox__title">{title}</h2>}
            {hint && <p className="panelbox__hint">{hint}</p>}
          </div>
          {actions && <div className="panelbox__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
