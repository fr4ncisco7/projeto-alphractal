import type { ReactNode } from "react";
import "./ui.css";

type ResourceStateProps = {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  /** Quantas linhas de esqueleto exibir enquanto carrega. */
  skeletonRows?: number;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
};

/**
 * Envolve o conteúdo que depende da API e cuida dos três estados
 * (carregando, erro, vazio) para as páginas não repetirem essa lógica.
 */
export function ResourceState({
  loading,
  error,
  onRetry,
  skeletonRows = 3,
  empty = false,
  emptyLabel = "Nada por aqui ainda.",
  children,
}: ResourceStateProps) {
  if (loading) {
    return (
      <div className="skeleton" aria-busy="true" aria-live="polite">
        {Array.from({ length: skeletonRows }, (_, index) => (
          <div key={index} className="skeleton__row" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="statebox statebox--error" role="alert">
        <p>{error}</p>
        {onRetry && (
          <button type="button" className="statebox__retry" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return <div className="statebox">{emptyLabel}</div>;
  }

  return <>{children}</>;
}
