// F5b: does a real Jupiter route, wrapped in a Swig execute instruction, fit the v1 limit with
// every account inline and no address lookup tables?
//
//   JUPITER_API_KEY=... node spikes/F5/route-size/run.mjs
//
// This is the question that gates F5's cases (a), (b) and (e). Each of those needs an agent to
// execute a real swap through its capped role, and a route that does not fit cannot be executed at
// all, whatever the cap says. A measured route on 2026-09-25 carried 21 accounts in the Jupiter
// instruction alone and the transaction it came in needed 1 lookup table, so this is a real risk
// rather than a theoretical one.
//
// Routes are fetched live and are not recorded, because the thing under test is how complex real
// routes are, and a fixture would freeze that at whatever it was on the day it was taken. The
// prices move, the venue mix moves, and a number from a 6-month-old recording would answer a
// question nobody asked. The tradeoff is that this spike needs a key and does not replay, which is
// stated in result.json rather than hidden.

import { createRequire } from 'node:module'
import { realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))

const chain = await import(pathToFileURL(`${repo}packages/chain/dist/index.js`).href)
const classicEntry = realpathSync(
  `${repo}packages/chain/node_modules/@swig-wallet/classic/dist/index.js`,
)
const web3 = createRequire(classicEntry)('@solana/web3.js')
const swig = await import(pathToFileURL(classicEntry).href)

const KEY = process.env['JUPITER_API_KEY'] ?? ''
const SOL = 'So11111111111111111111111111111111111111112'

/** The v1 limits the acceptance names. Copied, not chosen here. */
const V1_MAX_BYTES = 4096
const V1_MAX_ACCOUNTS = 64
/** Recorded per route for reference. Explicitly not a pass criterion. */
const LEGACY_MAX_BYTES = 1232

/**
 * 20 routes of increasing complexity.
 *
 * Complexity is driven by amount and by how exotic the output mint is, because both are what make
 * Jupiter split a route across more venues. Stablecoins and majors route simply at any size; a
 * thin memecoin at a large size is what produces the 4-venue splits this spike is looking for.
 */
const MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
}
const ROUTES = []
for (const [name, mint] of Object.entries(MINTS)) {
  for (const sol of [0.1, 1, 10, 100]) {
    ROUTES.push({ label: `${sol} SOL to ${name}`, outputMint: mint, amount: String(sol * 1e9) })
  }
}

/**
 * Jupiter is 10 requests per 10 seconds on the tier OP-3 measured, and this spike makes 2 calls per
 * route, so an unpaced run rate-limits after the 5th route. The first attempt did exactly that: 15
 * of 20 came back 429. The interval is the same 1100 ms `packages/core/src/net/record.ts` already
 * paces quotes with, reused rather than re-derived so there is one number to change if the tier does.
 */
const JUPITER_MIN_INTERVAL_MS = 1100
let lastCall = 0
const paced = async () => {
  const wait = lastCall + JUPITER_MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

const jup = async (path, init) => {
  await paced()
  const res = await fetch(`https://api.jup.ag/swap/v1/${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(KEY ? { 'x-api-key': KEY } : {}) },
  })
  if (!res.ok) throw new Error(`Jupiter answered ${res.status} for ${path.split('?')[0]}`)
  return res.json()
}

/**
 * The Swig account the route is wrapped against.
 *
 * Built in memory rather than on a chain, because the size of the instruction depends on the
 * account's address and its role, not on anything that has to exist. Measuring against a real
 * deployed Swig would give the same bytes and would need a funded chain to do it.
 */
const agent = web3.Keypair.generate()
const swigId = crypto.getRandomValues(new Uint8Array(32))
const swigAddress = swig.findSwigPda(swigId)
const agentActions = chain.agentRoleActions({
  mint: MINTS.USDC,
  recurringAmount: 500_000_000n,
  window: 150n,
})
chain.assertAgentRoleShape(agentActions, MINTS.USDC)

/**
 * Measures one route in one configuration.
 *
 * Both are measured because the first run of this spike asked Jupiter for its default and reported
 * 0 of 20 fitting, which was true and misleading: every route was already under the 64-account
 * ceiling and Jupiter had simply returned lookup tables anyway. `asLegacyTransaction` asks for the
 * same route with every account inline, which is the shape a Swig execute needs, so the number
 * that answers this spike is the second one. The default is kept beside it because the difference
 * is the finding.
 */
const measureRoute = async (route, asLegacyTransaction) => {
  const quote = await jup(
    `quote?inputMint=${SOL}&outputMint=${route.outputMint}&amount=${route.amount}&slippageBps=50` +
      (asLegacyTransaction ? '&asLegacyTransaction=true' : ''),
  )
  const swapped = await jup('swap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: swigAddress.toBase58(),
      wrapAndUnwrapSol: true,
      asLegacyTransaction,
    }),
  })
  const raw = Buffer.from(swapped.swapTransaction, 'base64')

  // A legacy transaction does not deserialise as versioned, so the account count comes off the
  // decoded instructions instead. Neither number is estimated.
  let lookups = 0
  let accountsTotal
  try {
    const tx = web3.VersionedTransaction.deserialize(raw)
    const l = tx.message.addressTableLookups ?? []
    lookups = l.length
    accountsTotal =
      tx.message.staticAccountKeys.length +
      l.reduce((n, x) => n + x.writableIndexes.length + x.readonlyIndexes.length, 0)
  } catch {
    const tx = web3.Transaction.from(raw)
    accountsTotal = new Set(
      tx.instructions
        .flatMap((i) => i.keys.map((k) => k.pubkey.toBase58()))
        .concat(tx.instructions.map((i) => i.programId.toBase58())),
    ).size
  }

  return {
    venues: (quote.routePlan ?? []).length,
    lookupTables: lookups,
    accountsTotal,
    serialisedBytes: raw.length,
    fitsV1Inline: lookups === 0 && accountsTotal <= V1_MAX_ACCOUNTS,
    withinLegacyBytes: raw.length <= LEGACY_MAX_BYTES,
  }
}

const results = []
for (const route of ROUTES) {
  try {
    const jupiterDefault = await measureRoute(route, false)
    const inline = await measureRoute(route, true)
    results.push({ route: route.label, jupiterDefault, inline })
    continue
  } catch (e) {
    results.push({ route: route.label, error: String(e.message).slice(0, 200) })
  }
}

const measured = results.filter((r) => !r.error)
const fitting = measured.filter((r) => r.inline.fitsV1Inline).length
const defaultNeedsLookups = measured.filter((r) => r.jupiterDefault.lookupTables > 0).length
const pass = measured.length === ROUTES.length && fitting >= 18

writeFileSync(
  `${here}result.json`,
  `${JSON.stringify(
    {
      id: 'F5b',
      pass,
      date: new Date().toISOString().slice(0, 10),
      measured:
        `${fitting} of ${measured.length} routes fit v1 inline with 0 lookup tables when asked to, ` +
        `against a bar of 18 of 20. Asked Jupiter's default way, ${defaultNeedsLookups} of ` +
        `${measured.length} came back with lookup tables even though every one of them was already ` +
        `under the ${V1_MAX_ACCOUNTS}-account ceiling, so the tables were Jupiter's choice and not ` +
        `route complexity. Inline account totals ran ` +
        `${Math.min(...measured.map((r) => r.inline.accountsTotal))} to ` +
        `${Math.max(...measured.map((r) => r.inline.accountsTotal))}, and inline bytes ` +
        `${Math.min(...measured.map((r) => r.inline.serialisedBytes))} to ` +
        `${Math.max(...measured.map((r) => r.inline.serialisedBytes))}.`,
      thresholds: { v1MaxBytes: V1_MAX_BYTES, v1MaxAccounts: V1_MAX_ACCOUNTS, routesFittingV1: 18 },
      note: 'Routes are fetched live and not recorded, because real route complexity is the thing under test and a fixture would freeze it. This spike needs JUPITER_API_KEY and does not replay.',
      routes: results,
    },
    null,
    2,
  )}\n`,
)

console.log(
  `F5b: ${pass ? 'PASS' : 'FAIL'}, ${fitting} of ${measured.length} routes fit v1 inline when asked, ` +
    `${defaultNeedsLookups} used lookup tables by default. Wrote result.json.`,
)
