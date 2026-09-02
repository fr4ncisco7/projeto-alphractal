import { afterAll, describe, expect, it } from "vitest";

/**
 * Testes que precisam de Postgres/TimescaleDB de verdade.
 *
 * Ficam fora da suíte padrão: `npm test` roda na máquina de qualquer um e em
 * CI sem banco. Para rodar: `TEST_DB=1 DATABASE_URL=... npm test`, ou
 * `./scripts/testar-backend.sh --db`.
 *
 * O que se testa aqui não é o SQL em si -- é o INVARIANTE do agregado, que só
 * uma consulta real exercita. A moda por histograma existe porque preço de gas
 * é contínuo: quase todo bloco tem valor distinto, então moda no sentido
 * estrito não existe. O backend agrupa em 40 faixas entre o mínimo e o máximo
 * do dia e devolve o centro da mais populosa.
 */
const comBanco = process.env.TEST_DB === "1";
const d = comBanco ? describe : describe.skip;

d("estatísticas do dia (com banco)", () => {
  it("a moda cai dentro do intervalo [mínimo, máximo]", async () => {
    // Regressão real: a versão anterior usava faixas fixas de 0,1 gwei e
    // devolvia moda 0,1 num dia cujo MÁXIMO era 0,089 -- um valor que não
    // existiu em bloco nenhum. Nenhum teste unitário pegaria isso; o
    // invariante só aparece contra dado de verdade.
    const { estatisticasDoDia } = await import("../src/db.js");
    const e = await estatisticasDoDia();

    if (e.blocos === 0) return;   // dia ainda sem blocos: nada a verificar

    expect(e.minimo_gwei).not.toBeNull();
    expect(e.moda_gwei).toBeGreaterThanOrEqual(e.minimo_gwei!);
    expect(e.moda_gwei).toBeLessThanOrEqual(e.maximo_gwei!);
    expect(e.mediana_gwei).toBeGreaterThanOrEqual(e.minimo_gwei!);
    expect(e.mediana_gwei).toBeLessThanOrEqual(e.maximo_gwei!);
  });

  it("a série horária volta ordenada e sem buracos", async () => {
    // O estimador exige série horária contígua; um buraco aqui vira erro no
    // solver, e é melhor descobrir no teste que no /otimizar.
    const { serieHoraria } = await import("../src/db.js");
    const serie = await serieHoraria(48);

    if (serie.length < 2) return;

    for (let i = 1; i < serie.length; i++) {
      const delta = serie[i].momento.getTime() - serie[i - 1].momento.getTime();
      expect(delta).toBe(3_600_000);
    }
  });

  it("as leituras respeitam o teto de janela", async () => {
    const { serieRecente } = await import("../src/db.js");
    const serie = await serieRecente(60);
    expect(serie.length).toBeLessThanOrEqual(61);
  });
});

afterAll(async () => {
  if (!comBanco) return;
  const { pool } = await import("../src/db.js");
  await pool.end();
});
