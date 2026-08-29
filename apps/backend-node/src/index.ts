import express from "express";
import { config } from "./config.js";
import { pool } from "./db.js";
import { iniciarIngestaoAoVivo } from "./ingestao.js";

const app = express();

app.get("/health", async (_req, res) => {
  try {
    const r = await pool.query<{ n: string; ultimo: Date | null }>(
      "SELECT count(*)::text AS n, max(momento) AS ultimo FROM bloco_gas",
    );
    res.json({
      status: "ok",
      blocos: Number(r.rows[0].n),
      ultimo_bloco_em: r.rows[0].ultimo,
      ingestao: config.ingestaoAtiva ? "ativa" : "desligada",
    });
  } catch (erro) {
    res.status(503).json({ status: "degradado", erro: String(erro) });
  }
});

app.listen(config.porta, () => {
  console.log(`backend-node ouvindo na porta ${config.porta}`);
  if (config.ingestaoAtiva) iniciarIngestaoAoVivo();
  else console.log("[ingestao] desligada (INGESTAO_ATIVA=false)");
});
