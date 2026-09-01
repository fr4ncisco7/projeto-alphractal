/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API. Vazia ou ausente ativa o backend simulado. */
  readonly VITE_API_URL?: string;
}
