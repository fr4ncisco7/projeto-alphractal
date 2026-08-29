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
} as const;
