import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { ApiError } from "../lib/errors";

export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

type State<T> = {
  path: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
};

function initialState<T>(path: string | null): State<T> {
  return { path, data: null, loading: path !== null, error: null };
}

/**
 * Busca um recurso da API assim que o componente monta.
 * Passe `null` como caminho para adiar a chamada.
 */
export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<State<T>>(() => initialState<T>(path));
  const [attempt, setAttempt] = useState(0);

  // Recurso trocou: descarta o anterior antes de disparar a nova busca.
  if (state.path !== path) {
    setState(initialState<T>(path));
  }

  useEffect(() => {
    if (!path) return;

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const data = await apiRequest<T>(path, { signal: controller.signal });
        if (!active) return;
        setState({ path, data, loading: false, error: null });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setState({
          path,
          data: null,
          loading: false,
          error:
            cause instanceof ApiError
              ? cause.message
              : "Não foi possível carregar os dados.",
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [path, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setAttempt((value) => value + 1);
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    reload,
  };
}
