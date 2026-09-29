// F4: do 20 scripted trades get the verdicts written down before this ran?
//
//   node scripts/spike.mjs F4
//
// The answers are in cases.json, committed with thresholds.json and before this file existed, so
// nothing here can be tuned to the result. Each case names its verdict and the exact set of rules
// that must fire, because a right verdict for the wrong reason is a wrong answer.
//
// Pure: the guard is arithmetic over data, so this needs no network, no key and no chain. The
// latency half runs the whole product path minus the network, decode to verdict over the recorded
// 100-transaction history, with the mint check handed in as data, which is what "excluding the
// RugCheck call" means.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assessTrade, checkTrade } from '../../packages/guard/dist/index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const { cases } = JSON.parse(readFileSync(`${here}cases.json`, 'utf8'))

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SLOT = 312904411
const ARITHMETIC = [
  'size-vs-median',
  'stop-vs-usual',
  'price-band',
  'slippage-tolerance',
  'style-fit',
]

const rules = [
  { kind: 'stop', found: true, value: 8, sampleSize: 214, requiredSampleSize: 20, reason: null },
  {
    kind: 'size',
    found: true,
    value: 800000000,
    sampleSize: 214,
    requiredSampleSize: 1,
    reason: null,
  },
  { kind: 'hold', found: true, value: 3600, sampleSize: 214, requiredSampleSize: 1, reason: null },
]

/** The profile in cases.json, with only what a case names changed. */
const factsFor = (c) => ({
  mint: {
    mint: MINT,
    verdict: c.mintBlock ? 'block' : 'pass',
    reasons: c.mintBlock
      ? [
          {
            rule: c.mintBlock,
            message:
              'This token has a permanent delegate, which can move your balance without your signature. Trade a token without one.',
          },
        ]
      : [],
    dataSlot: SLOT,
    ruleVersion: 'mint-check/1',
    facts: null,
  },
  rules,
  quote: c.noQuote
    ? null
    : {
        priceImpactPct: c.priceImpactPct ?? '0.0027',
        slippageBps: c.slippageBps ?? 50,
        contextSlot: SLOT,
      },
  jev: {
    answers: {
      tokenCategory: { category: c.category ?? 'blue chip', confidence: 0.9 },
      injection: { looksInjected: c.injected === true, confidence: 0.9 },
    },
    dataSlot: SLOT,
    ruleVersion: 'jev/1',
    blocked: c.injected === true,
    reasons: c.injected
      ? [
          {
            rule: 'injection-screen',
            message:
              'This token’s text contains an instruction aimed at an agent. Not safe to proceed.',
          },
        ]
      : [],
  },
  spendAsset: { symbol: 'SOL', decimals: 9 },
  categoryMix: { 'blue chip': 1 },
  proposedStopPct: c.stopPct,
  ruleVersion: 'profile-2026-09-24-a',
})

const perCase = cases.map((c) => {
  const out = checkTrade(
    { wallet: WALLET, mint: MINT, side: c.side, size: String(c.size) },
    factsFor(c),
  )
  const fired = out.reasons.map((r) => r.rule).sort()
  const want = [...c.rules].sort()
  const unnumbered = out.reasons
    .filter((r) => ARITHMETIC.includes(r.rule))
    .filter((r) => typeof r.observed !== 'number' || typeof r.limit !== 'number')
    .map((r) => r.rule)
  const ok =
    out.verdict === c.expect &&
    JSON.stringify(fired) === JSON.stringify(want) &&
    unnumbered.length === 0
  return {
    id: c.id,
    what: c.what,
    ok,
    expected: `${c.expect} [${want.join(', ')}]`,
    got: `${out.verdict} [${fired.join(', ')}]`,
    ...(unnumbered.length ? { unnumbered } : {}),
    ...(ok ? {} : { messages: out.reasons.map((r) => `${r.rule}: ${r.message}`) }),
  }
})

// Latency: the product path minus the network, over the committed recording of 100 transactions.
const recorded = JSON.parse(
  readFileSync(`${here}../../fixtures/recorded/helius/0a54104d4bc5085a.json`, 'utf8'),
).response.body
const { fromEnhanced } = await import('../../packages/decoder/dist/enhanced.js')
const txs = recorded.map(fromEnhanced)
const cleanMint = factsFor({}).mint
const RUNS = 200
const times = []
for (let i = 0; i < RUNS; i++) {
  const t0 = process.hrtime.bigint()
  assessTrade(
    txs,
    {
      wallet: 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC',
      mint: MINT,
      side: 'buy',
      size: '800000000',
    },
    cleanMint,
  )
  times.push(Number(process.hrtime.bigint() - t0) / 1e6)
}
times.sort((a, b) => a - b)
const pct = (p) =>
  Math.round(times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)] * 100) / 100
const p50 = pct(0.5)
const p95 = pct(0.95)

const matched = perCase.filter((c) => c.ok).length
const pass = matched === cases.length && p95 <= 300

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const missed = perCase.filter((c) => !c.ok)
const result = {
  id: 'F4',
  pass,
  measured:
    `${matched} of ${cases.length} verdicts matched the answers written in advance` +
    (missed.length
      ? ` (missed: ${missed.map((c) => `#${c.id} ${c.what}, expected ${c.expected}, got ${c.got}`).join('; ')})`
      : '') +
    `; p95 ${p95} ms and p50 ${p50} ms over ${RUNS} runs of decode to verdict on ${txs.length} recorded transactions, network excluded`,
  date: new Date().toISOString().slice(0, 10),
  commit,
  dataSlot: SLOT,
  notes:
    'Answers in cases.json, committed before this runner existed. Latency is measured on this machine, not the deployment region.',
  perCase,
}
writeFileSync(`${here}result.json`, JSON.stringify(result, null, 2) + '\n')
console.log(`F4: ${pass ? 'PASS' : 'FAIL'}, ${result.measured}`)
