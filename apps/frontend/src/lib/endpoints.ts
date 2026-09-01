/**
 * Único lugar onde os caminhos do backend são declarados.
 * Ao plugar a API real, ajuste apenas os valores abaixo.
 */
export const endpoints = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  overview: "/dashboard/overview",
  analysisAssets: "/analysis/assets",
  predictions: "/predictions/latest",
} as const;
