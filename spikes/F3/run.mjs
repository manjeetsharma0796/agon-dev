// F3: does our own mint check flag the dangerous mints and leave the blue chips alone?
//
//   node scripts/spike.mjs F3                       replay, no keys, no network
//   AGON_NET_MODE=record HELIUS_API_KEY=... node scripts/spike.mjs F3   refresh the fixture
//
// The check under test is the production one, packages/guard checkMints, not a copy of it. A spike
// that reimplements the thing it is measuring measures the reimplementation.
//
// Fixtures live in this directory rather than fixtures/recorded, so the labelled set and the
// response it was labelled from travel together and cannot drift apart.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// Relative into dist, not by package name: spikes/ is not a workspace package, so the root has no
// @agon/* link to resolve. Both workflows that run a spike do `pnpm build` first.
import { call } from '../../packages/core/dist/index.js'
import { checkMints } from '../../packages/guard/dist/index.js'

// fileURLToPath, not URL.pathname: pathname keeps the percent encoding, so any checkout whose path
// contains a space resolves to a directory that does not exist.
const here = fileURLToPath(new URL('.', import.meta.url))
const labels = JSON.parse(readFileSync(`${here}mints.json`, 'utf8'))
const groups = ['blueChip', 'dangerousAuthority', 'dangerousToken2022']
const mints = groups.flatMap((g) => labels[g].map((m) => m.mint))
const symbolOf = new Map(groups.flatMap((g) => labels[g].map((m) => [m.mint, m.symbol])))

const checks = await checkMints(mints, {
  net: (req) => call(req, { root: `${here}recorded` }),
})

const flagged = (mint) => checks.get(mint)?.verdict === 'block'
const rulesFor = (mint) => (checks.get(mint)?.reasons ?? []).map((r) => r.rule)

const per = Object.fromEntries(
  groups.map((g) => {
    const rows = labels[g].map((m) => ({
      symbol: m.symbol,
      mint: m.mint,
      flagged: flagged(m.mint),
      rules: rulesFor(m.mint),
    }))
    return [g, rows]
  }),
)

const dangerous = [...per.dangerousAuthority, ...per.dangerousToken2022]
const caught = dangerous.filter((r) => r.flagged).length
const blueFlagged = per.blueChip.filter((r) => r.flagged)

// The threshold, exactly as spikes/F3/thresholds.json states it: 20 of 20, and 0 of 10.
const pass = caught === 20 && blueFlagged.length === 0

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const result = {
  id: 'F3',
  pass,
  measured: `${caught}/20 dangerous flagged, ${blueFlagged.length}/10 blue chips flagged (${
    blueFlagged.map((r) => r.symbol).join(', ') || 'none'
  })`,
  date: new Date().toISOString().slice(0, 10),
  commit,
  dataSlot: checks.get(mints[0])?.dataSlot ?? null,
  notes:
    'The 2 blue chips flagged are USDC and USDT, both for a live freeze authority, which is the ' +
    'same trait the dangerous set is labelled by. The 10 fee-only Token-2022 mints are reported ' +
    'and not blocked, because a fee is a cost and not a way to take the position. Both are stated ' +
    'in full in spikes/F3/README.md.',
  perMint: per,
}

mkdirSync(here, { recursive: true })
writeFileSync(`${here}result.json`, `${JSON.stringify(result, null, 2)}\n`)

console.log(`F3: ${pass ? 'pass' : 'FAIL'}, ${result.measured}`)
for (const g of groups) {
  const rows = per[g]
  console.log(`  ${g}: ${rows.filter((r) => r.flagged).length}/${rows.length} flagged`)
  for (const r of rows) {
    console.log(
      `    ${r.flagged ? 'BLOCK' : '     '} ${String(r.symbol).padEnd(11)} ${r.rules.join(' ') || '-'}`,
    )
  }
}
