import { defineConfig } from "vitest/config";

// Config isolada do vite.config.ts da aplicação (Fase 2 da auditoria) —
// os testes cobrem lógica pura (indicators, strategy, marketStructure,
// backtest), sem necessidade de DOM nem dos plugins da app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
