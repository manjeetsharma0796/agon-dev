// F1, the 2-public-wallet half: can we turn raw transactions into buys and sells with exact amounts?
//
//   node scripts/spike.mjs F1                                        replay, no keys, no network
//   AGON_NET_MODE=record HELIUS_API_KEY=... node scripts/spike.mjs F1  refresh the fixtures
//
// The decoder under test is the production one in packages/decoder, not a copy. A spike that
// reimplements the thing it measures proves the spike works.
//
// Two wallets, chosen because their swaps span 4 or more venues. They are used to measure decoding
// and nothing else: no balance, position or profit is reported for either, because the PRD bars
// describing a named person's habits and a decode test needs none of that.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decodeAll, decodeTransaction as decodeOne } from '../../packages/decoder/dist/index.js'

const HERE = new URL('.', import.meta.url)
const path = (p) => fileURLToPath(new URL(p, HERE))
const RECORDED = path('recorded/')
const record = process.env.AGON_NET_MODE === 'record'

const WALLETS = JSON.parse(readFileSync(path('wallets.json'), 'utf8')).wallets

/** How many transactions we sample per wallet and compare field by field. The acceptance says 50. */
const SAMPLE = 50

/**
 * Deterministic sampling. A spike whose sample changes between runs cannot be rerun by a sceptic,
 * and "50 of 50" would mean a different 50 each time. Seeded by the wallet, so each gets its own
 * draw and both are reproducible from the address alone.
 */
function seededPick(items, n, seed) {
  let h = 0
  for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0
  const rnd = () => ((h = (Math.imul(h, 1103515245) + 12345) | 0) >>> 1) / 2 ** 31
  const pool = [...items]
  const out = []
  while (out.length < Math.min(n, items.length))
    out.push(...pool.splice(Math.floor(rnd() * pool.length), 1))
  return out
}

const fixture = (name) => `${RECORDED}${name}.json`

async function cached(name, fetchIt) {
  if (!record) {
    if (!existsSync(fixture(name))) {
      throw new Error(
        `No recording for ${name}. Run with AGON_NET_MODE=record and HELIUS_API_KEY set, or ` +
          `check out the fixture. A spike must never invent the data it measures.`,
      )
    }
    return JSON.parse(readFileSync(fixture(name), 'utf8')).body
  }
  const body = await fetchIt()
  mkdirSync(RECORDED, { recursive: true })
  writeFileSync(
    fixture(name),
    JSON.stringify({ recordedAt: new Date().toISOString(), body }, null, 2) + '\n',
  )
  return body
}

const KEY = process.env.HELIUS_API_KEY
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * One RPC call, retried with backoff.
 *
 * A hundred getTransaction calls back to back resets the connection on the free tier, so recording
 * the fixture failed halfway and left a partial one. Retrying is not politeness: a spike that can
 * only be recorded on a good day cannot be rerun by a sceptic, which is the whole point of F9.
 */
const rpc = async (method, params, attempt = 0) => {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const j = await r.json()
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`)
    return j.result
  } catch (e) {
    if (attempt >= 4) throw e
    await sleep(500 * 2 ** attempt)
    return rpc(method, params, attempt + 1)
  }
}

const results = []

for (const wallet of WALLETS) {
  const short = wallet.slice(0, 8)

  // Helius's own labelling, produced without seeing our decoder. This is the independent source the
  // sampled comparison is made against, and it is weaker than the hand-built ledger the PRD asks
  // for: it is another program's opinion, not a person's arithmetic. Reported as exactly that.
  const enhanced = await cached(`${short}-enhanced`, async () => {
    const out = []
    let before = ''
    while (out.length < 400) {
      const url =
        `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${KEY}&limit=100` +
        (before ? `&before=${before}` : '')
      const page = await (await fetch(url)).json()
      if (!Array.isArray(page) || page.length === 0) break
      // Only the 3 fields this spike uses: which transactions to sample, how many are swaps, and
      // which venues. Storing the full records cost 17.7 MB across 2 wallets for data that is not
      // under test. The raw transactions below stay complete, because those are what the decoder
      // reads and trimming them would remove the shapes it has to survive.
      out.push(...page.map((t) => ({ signature: t.signature, type: t.type, source: t.source })))
      before = page[page.length - 1].signature
    }
    return out
  })

  const labelledSwaps = enhanced.filter((t) => t.type === 'SWAP')
  const venues = [...new Set(labelledSwaps.map((t) => t.source))].sort()

  // The sample, drawn from what the independent source calls a swap, because those are the ones
  // whose classification and amounts can be checked against something.
  const sample = seededPick(
    labelledSwaps.map((t) => t.signature),
    SAMPLE,
    wallet,
  )

  const raw = await cached(`${short}-raw`, async () => {
    const out = []
    for (const sig of sample) {
      out.push(
        await rpc('getTransaction', [
          sig,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 2 },
        ]),
      )
      await sleep(120) // paced, because the free tier resets the connection under a tight loop
    }
    return out
  })

  const decoded = decodeAll(raw.filter(Boolean), wallet)

  // What the decoder actually said about each sampled transaction, in full. Not a score against
  // Helius: that comparison is invalid and the README says why. This is the distribution a person
  // needs in front of them to build the 50-row ledger the acceptance really asks for.
  const outcomes = {}
  for (const tx of raw.filter(Boolean)) {
    const d = decodeOne(tx, wallet)
    const key = d.kind + (d.reason ? `: ${d.reason}` : '')
    outcomes[key] = (outcomes[key] ?? 0) + 1
  }

  // The one thing this run CAN assert on its own: every transaction landed in exactly one bucket
  // and none was dropped. A coverage number computed over silently discarded transactions is a
  // number that lies, which is the failure the third bucket exists to prevent.
  const classified =
    decoded.swaps.length +
    decoded.notSwaps.length +
    decoded.unsupported.reduce((n, u) => n + u.count, 0)
  const noSilentDrops = classified === raw.filter(Boolean).length

  results.push({
    wallet,
    swapsSeen: labelledSwaps.length,
    venues,
    sampled: sample.length,
    outcomes,
    swapsDecoded: decoded.swaps.length,
    noSilentDrops,
    coverage: decoded.coverage,
    unsupported: decoded.unsupported,
  })
}

const sampledTotal = results.reduce((n, r) => n + r.sampled, 0)
const noSilentDrops = results.every((r) => r.noSilentDrops)

// Deliberately false, and it stays false until OP-20 lands. The acceptance is 50 of 50 classified
// correctly, and correctly can only be settled against a hand-built ledger: the automated oracle
// tried here disagrees with the decoder by definition rather than by error, and neither wallet in
// wallets.json turned out to be a retail trader. Both are measured in the README. Passing this on
// the mechanical half alone would be the green row with nothing behind it that the board refuses.
const pass = false

let commit = 'unknown'
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  /* not a checkout */
}

const result = {
  id: 'F1',
  pass,
  measured:
    `${sampledTotal} transactions decoded across ${results.length} wallets, ${noSilentDrops ? '0' : 'SOME'} silent drops; ` +
    `0 of 50 verified against a hand-built ledger, which is what the acceptance asks for and what OP-20 is; ` +
    results
      .map(
        (r) =>
          `${r.wallet.slice(0, 8)} ${r.swapsDecoded} swaps decoded of ${r.sampled} sampled over ${r.venues.length} venues`,
      )
      .join('; '),
  date: new Date().toISOString().slice(0, 10),
  commit,
  notes:
    'FAIL, and not because the decoder is wrong. Two findings, both measured. (1) Helius ' +
    '/addresses/{x}/transactions returns everything INVOLVING x, so an address that is never the ' +
    'owner of a token balance looks like a busy trader: 7xKXtg2C showed 21 swaps per 100 ' +
    'transactions and decoded to 0 of 42, correctly, because no balance of that wallet moved. ' +
    '(2) Even for a real owner, Helius SWAP and our swap mean different things: 22 of 50 on ' +
    '5Q544fKr were quote-to-quote rotations that open and close no position, which the decoder ' +
    'excludes on purpose. So the enhanced API cannot be the oracle, and the hand-built ledger the ' +
    'PRD asks for is not bureaucracy, it is the only source that settles the question. (3) ' +
    'Corrected by T-A07: 5CKAa7Wm was read as 50 of 50 value-only-arrived and called a payout ' +
    'address, and that was the decoder missing the native SOL leg. It now reads as 9 rotations ' +
    'and 41 one-sided, which is arbitrage flow rather than a payout address, and the swap count ' +
    'is still 0 because there are no swaps in it: the token gains are 3840 lamports and 0.007 ' +
    'USDC against a fee of the same order. So the decoder is right and the wallet is wrong, ' +
    'which is OP-31. Picking the 2 wallets needs a person, which is OP-20.',
  perWallet: results,
}

writeFileSync(path('result.json'), JSON.stringify(result, null, 2) + '\n')

console.log(`F1: ${pass ? 'pass' : 'FAIL'}, ${result.measured}`)
for (const r of results) {
  console.log(
    `  ${r.wallet.slice(0, 8)}  ${r.swapsDecoded} swaps of ${r.sampled} sampled, silent drops: ${r.noSilentDrops ? 0 : 'SOME'}, venues: ${r.venues.join(', ')}`,
  )
  for (const [k, v] of Object.entries(r.outcomes).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(3)}  ${k}`)
  }
  for (const u of r.unsupported)
    console.log(`    unsupported ${u.programId.slice(0, 8)} x${u.count}: ${u.reason}`)
}
// No process.exit on a failing measurement, matching F3 and F9. A spike's job is to run and record
// honestly; FEASIBILITY.md carries pass or fail and the checkpoint decides. Exiting 1 here would
// make a legitimately failing existential spike a required-check failure on every PR in the repo,
// freezing merges at exactly the moment the fixes need to land.
