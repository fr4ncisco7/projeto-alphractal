import "./Backdrop.css";

type BackdropProps = {
  /** `auth` acende o canto inferior esquerdo; `app` concentra o brilho à direita. */
  variant?: "auth" | "app";
};

/**
 * Layered atmosphere: aurora bloom, drifting orbs, film grain and vignette.
 * Purely decorative — kept out of the accessibility tree.
 */
export function Backdrop({ variant = "auth" }: BackdropProps) {
  return (
    <div className={`backdrop backdrop--${variant}`} aria-hidden="true">
      <div className="backdrop__base" />
      <div className="backdrop__aurora backdrop__aurora--left" />
      <div className="backdrop__aurora backdrop__aurora--accent" />
      <div className="backdrop__aurora backdrop__aurora--right" />
      <div className="backdrop__aurora backdrop__aurora--top" />
      <div className="backdrop__grain" />
      <div className="backdrop__vignette" />
    </div>
  );
}
