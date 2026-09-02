import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Os módulos guardam estado no escopo do módulo (o cache da cotação, o Set
    // de assinantes). Arquivos em processos separados impedem que um teste veja
    // o estado deixado por outro.
    pool: "forks",
    environment: "node",
  },
});
