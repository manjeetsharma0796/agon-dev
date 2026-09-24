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

// The threshold, exactly as spikes/F3/thresholds.json states it after the CP1 decision: every
// seizure mint blocked, no blue chip blocked, and no fee-only mint blocked, because a fee is a cost
// and gets reported with its basis points instead.
const seizure = per.dangerousAuthority
const caught = seizure.filter((r) => r.flagged).length
const blueFlagged = per.blueChip.filter((r) => r.flagged)
const feeBlocked = per.dangerousToken2022.filter((r) => r.flagged)

const pass = caught === seizure.length && blueFlagged.length === 0 && feeBlocked.length === 0

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
  measured: `${caught}/${seizure.length} seizure mints blocked, ${blueFlagged.length}/${per.blueChip.length} blue chips blocked, ${feeBlocked.length}/${per.dangerousToken2022.length} fee-only blocked (${
    blueFlagged.map((r) => r.symbol).join(', ') || 'none'
  })`,
  date: new Date().toISOString().slice(0, 10),
  commit,
  dataSlot: checks.get(mints[0])?.dataSlot ?? null,
  notes:
    'Blocks on seizure only, decided at CP1 on 2026-09-24. USDC, USDT and cbBTC carry a live ' +
    'freeze authority and pass, each with that fact reported as its own reason, because for a ' +
    'regulated issuer it is how a court order is obeyed and the mint account cannot tell that ' +
    'apart from a deployer taking your position. The 10 fee-only Token-2022 mints are reported ' +
    'with their basis points and not blocked, because a fee is a cost and not a seizure. What ' +
    'this does not catch: a mint that can freeze but not seize passes with a warning. The full ' +
    'reasoning, and what would close that, is in spikes/F3/README.md.',
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
