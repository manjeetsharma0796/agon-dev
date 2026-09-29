#!/usr/bin/env node
// Generates docs/public/mcp-tools.md from the frozen contracts. Never hand-edit the output.
//
//   node scripts/mcp-docs.mjs            rewrite the reference
//   node scripts/mcp-docs.mjs --check    fail if the committed file is stale
//
// T-C01's whole argument is one definition with four consumers, proven by one shape change failing
// in all four. A tool reference written by hand would be a fifth consumer that fails nowhere: it
// would still describe the old shape, in the public repo, to the agent authors we are asking to
// integrate. So it is generated from `toolJsonSchemas`, which is generated from the same zod.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const OUT = 'docs/public/mcp-tools.md'

if (!existsSync('packages/core/dist/index.js')) {
  console.error('mcp-docs: packages/core is not built. Run `pnpm build` first.')
  process.exit(1)
}
const { TOOLS, toolJsonSchemas } = await import('../packages/core/dist/index.js')

/** Budgets CI enforces, so the page states what an integrator will actually hit. */
const BUDGETS = { get_report: '2,000 tokens', check_trade: '400 tokens' }

const WHAT = {
  get_report:
    'Reads a wallet and returns its trading profile: the rules it actually follows, what breaking them cost, and what share of its swaps the numbers are based on.',
  check_trade:
    'Answers whether one proposed trade fits that profile. Arithmetic first, and every reason carries the rule that produced it.',
  arm_rule:
    'Returns a link to the arming screen. The user connects their own wallet there and sets the limit from what their history suggests; this tool never names one.',
  list_rules: 'Lists the caps currently armed for a wallet.',
}

const fence = (value) => '```json\n' + JSON.stringify(value, null, 2) + '\n```'

const body = [
  '# The Agon MCP tools',
  '',
  '**Generated from the frozen contracts by `scripts/mcp-docs.mjs`. Never hand-edit it.** The',
  'schemas below are the same ones the server validates against, so this page cannot describe a',
  'shape the server does not accept.',
  '',
  `Four tools, and the list is stable: an agent's prompt cache is keyed on it, so adding or`,
  'reordering one costs every user a cache miss.',
  '',
  ...TOOLS.flatMap((name) => {
    const budget = BUDGETS[name]
    return [
      `## \`${name}\``,
      '',
      WHAT[name],
      '',
      ...(budget === undefined ? [] : [`Response budget: **${budget}**, enforced in CI.`, '']),
      '**Input**',
      '',
      fence(toolJsonSchemas[name].input),
      '',
      '**Output**',
      '',
      fence(toolJsonSchemas[name].output),
      '',
    ]
  }),
  '## What the schemas do not say',
  '',
  'Some rules are cross-field and JSON Schema cannot express them, so they are enforced when the',
  'call is parsed rather than described here. A verdict that is not `pass` must carry at least one',
  'reason. A reason carrying a number must carry its limit and its unit too, because a number',
  'without either cannot be shown to anyone. A coverage share must equal its own counts rather than',
  'being reported separately. An incomplete read must say why it stopped.',
  '',
  'A call that breaks one of those is refused with the reason, not silently accepted.',
  '',
].join('\n')

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== body) {
    console.error(
      `::error::${OUT} is stale. Run 'node scripts/mcp-docs.mjs' and commit the result.`,
    )
    process.exit(1)
  }
  console.log(`mcp-docs: ${OUT} is current, ${TOOLS.length} tools.`)
  process.exit(0)
}

writeFileSync(OUT, body)
console.log(`mcp-docs: wrote ${OUT}, ${TOOLS.length} tools.`)
