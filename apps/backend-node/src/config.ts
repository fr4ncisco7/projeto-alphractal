export const config = {
  porta: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Aceita qualquer provedor: Alchemy, Infura, publicnode, nó próprio.
  // WS é usado para a ingestão ao vivo; HTTP para backfill e para o
  // eth_feeHistory de cada bloco.
  rpcHttpUrl: process.env.RPC_HTTP_URL ?? "https://ethereum-rpc.publicnode.com",
  rpcWsUrl: process.env.RPC_WS_URL ?? "wss://ethereum-rpc.publicnode.com",

  // Ligar a ingestão ao vivo junto com o servidor.
  ingestaoAtiva: process.env.INGESTAO_ATIVA !== "false",

  // O solver é um serviço separado (decisão 12): Node não roda statsmodels.
  // O nome do host vem da rede interna do compose.
  solverUrl: process.env.SOLVER_URL ?? "http://solver-python:8000",

  // O custo do /optimize é o ajuste do Holt-Winters, medido em 77-158ms. 15s
  // é folga larga; existe para o pedido não pendurar se o solver travar.
  solverTimeoutMs: Number(process.env.SOLVER_TIMEOUT_MS ?? 15_000),
} as const;
