/**
 * Único lugar onde os caminhos do backend são declarados.
 *
 * Os nomes seguem a convenção do projeto: termos do protocolo Ethereum em
 * inglês (`gas`, `stream`), o resto em português. É a mesma convenção usada no
 * schema do banco e no backend, para o mesmo conceito não trocar de nome ao
 * atravessar a fronteira entre serviços.
 */
export const endpoints = {
  // Autenticação -- atendida só pelo backend simulado; o backend do Fees
  // Monitor não tem login. Mantida para a casca do shell continuar de pé.
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",

  /** Estado do banco, da ingestão, do solver e nº de conexões SSE. */
  saude: "/health",
  /** Série de 1 minuto para o gráfico ao vivo. Aceita `?minutos=`. */
  gasRecente: "/gas/recente",
  /** Média, mediana e moda do dia. */
  gasEstatisticas: "/gas/estatisticas",
  /** Agregado horário para o calendário/heatmap. Aceita `?dias=`. */
  gasCalendario: "/gas/calendario",
  /** Cotação ETH/USD, com a fonte e o instante. */
  cotacao: "/cotacao",
  /** Server-Sent Events: um evento por bloco novo. Consumir com EventSource. */
  stream: "/stream",
  /** Plano de execução para N transações até um prazo. POST. */
  otimizar: "/otimizar",
} as const;
