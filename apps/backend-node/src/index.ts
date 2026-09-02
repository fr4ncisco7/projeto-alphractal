/**
 * Ponto de entrada do processo: sobe o servidor e liga a ingestão ao vivo.
 *
 * A montagem do app mora em `app.ts`, para os testes poderem importar as rotas
 * sem abrir porta nem conectar no nó.
 */
import { app } from "./app.js";
import { config } from "./config.js";
import { iniciarIngestaoAoVivo } from "./ingestao.js";

app.listen(config.porta, () => {
  console.log(`backend-node ouvindo na porta ${config.porta}`);
  if (config.ingestaoAtiva) iniciarIngestaoAoVivo();
  else console.log("[ingestao] desligada (INGESTAO_ATIVA=false)");
});
