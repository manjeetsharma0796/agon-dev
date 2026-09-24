import { defineConfig } from 'vitest/config'

// Three projects because feasibility-offline runs the last two by name. They are separate so a
// blown budget reads as "the agent response got too big", not as one more failing unit test.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/**/*.test.ts', 'scripts/**/*.test.mjs'],
          passWithNoTests: true,
        },
      },
      {
        // Network calls per operation: check_trade 1 account batch, 1 quote, 1 Jev call; history
        // at most 1 page per 100 txs. The counting wrapper lands in packages/core with T-C01, so
        // there is nothing to count yet.
        test: {
          name: 'budget',
          include: ['{apps,packages}/*/**/*.budget.test.ts'],
          passWithNoTests: true,
        },
      },
      {
        // MCP response sizes: get_report 2,000 tokens, check_trade 400. Lands with T-C07.
        test: {
          name: 'token-budget',
          include: ['{apps,packages}/*/**/*.token.test.ts'],
          passWithNoTests: true,
        },
      },
    ],
  },
})
