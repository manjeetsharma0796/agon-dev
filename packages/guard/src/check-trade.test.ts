import { expect, test } from 'vitest'
import type { MinedRule } from '@agon/core'
import { LIMITS, STOP_TOLERANCE_POINTS, checkTrade, type TradeFacts } from './check-trade.js'
import type { MintCheck } from './mint-check.js'
import type { JevVerdict } from './jev/index.js'

// T-C06. Every number below is a comparison the guard has to get right before money moves, so each
// property is asserted twice: once where the check must fire, and once where it must not. A test
// that only proves a block can be passed by a function that blocks everything.

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SLOT = 312904411

/** 0.8 SOL in lamports, the median in the frozen contract's own check-trade example. */
const MEDIAN = 800_000_000

const mintPass = (): MintCheck => ({
  mint: MINT,
  verdict: 'pass',
  reasons: [],
  dataSlot: SLOT,
  ruleVersion: 'mint-check/1',
  facts: {
    mint: MINT,
    program: 'spl-token',
    mintAuthority: null,
    freezeAuthority: null,
    permanentDelegate: null,
    transferHookProgram: null,
    transferFeeBps: null,
  },
})

const mintUnreadable = (): MintCheck => ({
  mint: MINT,
  verdict: 'block',
  reasons: [{ rule: 'mint-rpc-unreachable', message: 'Could not verify this token.' }],
  dataSlot: null,
  ruleVersion: 'mint-check/1',
  facts: null,
})

const rules = (over: Partial<Record<MinedRule['kind'], MinedRule>> = {}): MinedRule[] => [
  over.stop ?? {
    kind: 'stop',
    found: true,
    value: 8,
    sampleSize: 214,
    requiredSampleSize: 20,
    reason: null,
  },
  over.size ?? {
    kind: 'size',
    found: true,
    value: MEDIAN,
    sampleSize: 214,
    requiredSampleSize: 1,
    reason: null,
  },
  over.hold ?? {
    kind: 'hold',
    found: true,
    value: 3600,
    sampleSize: 214,
    requiredSampleSize: 1,
    reason: null,
  },
]

const jevClean = (): JevVerdict => ({
  answers: {
    tokenCategory: { category: 'blue chip', confidence: 0.9 },
    injection: { looksInjected: false, confidence: 0.9 },
  },
  dataSlot: SLOT,
  ruleVersion: 'jev/1',
  blocked: false,
  reasons: [],
})

const facts = (over: Partial<TradeFacts> = {}): TradeFacts => ({
  mint: mintPass(),
  rules: rules(),
  quote: { priceImpactPct: '0.0027', slippageBps: 50, contextSlot: SLOT },
  jev: jevClean(),
  spendAsset: { symbol: 'SOL', decimals: 9 },
  categoryMix: { 'blue chip': 0.7, memecoin: 0.3 },
  ruleVersion: 'profile-2026-09-24-a',
  ...over,
})

const buy = (size: number) => ({
  mint: MINT,
  side: 'buy',
  size: String(Math.round(size)),
  wallet: WALLET,
})

const ruleNames = (out: { reasons: { rule: string }[] }) => out.reasons.map((r) => r.rule)

test('a trade over twice the wallet own median size is blocked, with the multiple and the median', () => {
  const out = checkTrade(buy(MEDIAN * 4.1), facts())
  expect(out.verdict).toBe('block')
  const size = out.reasons.find((r) => r.rule === 'size-vs-median')
  expect(size?.observed).toBeCloseTo(4.1, 2)
  expect(size?.limit).toBe(LIMITS.sizeMultiple)
  expect(size?.unit).toBe('x-median')
  // The number a trader can act on has to be in the sentence, not only in the fields.
  expect(size?.message).toContain('4.1x')
  expect(size?.message).toContain('0.8 SOL')
})

test('negative control: a trade at exactly the limit passes, so the guard is not just blocking', () => {
  const out = checkTrade(buy(MEDIAN * LIMITS.sizeMultiple), facts())
  expect(out.verdict).toBe('pass')
  expect(ruleNames(out)).not.toContain('size-vs-median')
})

test('a sell is never sized against a median held in quote units', () => {
  // medianSize is the median cost basis, in the quote asset. A sell size is in the mint own base
  // units. Comparing them is the "positions that were trade flow, off by 67x" bug with a Solana
  // accent, and a memecoin sell of 40,000,000,000 units would block every exit the user needs.
  const out = checkTrade({ ...buy(MEDIAN * 50), side: 'sell' }, facts())
  expect(ruleNames(out)).not.toContain('size-vs-median')
  expect(out.verdict).toBe('pass')
})

test('a token the chain could not be read for is blocked whatever the numbers say', () => {
  const out = checkTrade(buy(MEDIAN), facts({ mint: mintUnreadable() }))
  expect(out.verdict).toBe('block')
  expect(ruleNames(out)).toContain('mint-rpc-unreachable')
})

test('a mint check about a different mint is blocked rather than trusted', () => {
  const other = { ...mintPass(), mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs' }
  const out = checkTrade(buy(MEDIAN), facts({ mint: other }))
  expect(out.verdict).toBe('block')
  expect(ruleNames(out)).toContain('mint-check-mismatch')
})

test('the injection screen blocks a trade whose numbers are all inside the limits', () => {
  const injected: JevVerdict = {
    ...jevClean(),
    blocked: true,
    reasons: [{ rule: 'injection-screen', message: 'The text is addressed to your agent.' }],
  }
  const out = checkTrade(buy(MEDIAN), facts({ jev: injected }))
  expect(out.verdict).toBe('block')
  expect(ruleNames(out)).toContain('injection-screen')
})

test('an impersonation flag is unsure, never a quiet pass and never a model deciding', () => {
  // T-C05 sets `blocked` for the injection screen only, so this reason arrives here unblocked.
  // Passing it through as a warning would let an agent trade a fake USDC with a note attached.
  const fake: JevVerdict = {
    ...jevClean(),
    reasons: [{ rule: 'token-impersonation', message: 'This symbol imitates a better known one.' }],
  }
  const out = checkTrade(buy(MEDIAN), facts({ jev: fake }))
  expect(out.verdict).toBe('unsure')
  expect(ruleNames(out)).toContain('token-impersonation')
})

test('arithmetic alone can block, so a blocked trade needs 0 model answers', () => {
  // This is the "0 model calls when all guards resolve arithmetically" clause. With no Jev answer
  // at all the oversized trade still blocks, so the caller never has to make the call.
  const out = checkTrade(buy(MEDIAN * 4.1), facts({ jev: null }))
  expect(out.verdict).toBe('block')
  expect(ruleNames(out)).toContain('size-vs-median')
})

test('negative control: numbers inside the limits with no screen is unsure, never pass', () => {
  // unsure is not a soft pass. Text nobody screened cannot be called safe.
  const out = checkTrade(buy(MEDIAN), facts({ jev: null }))
  expect(out.verdict).toBe('unsure')
  expect(ruleNames(out)).toContain('text-not-screened')
})

test('no quote is unsure, because what the fill costs was never checked', () => {
  const out = checkTrade(buy(MEDIAN), facts({ quote: null }))
  expect(out.verdict).toBe('unsure')
  expect(ruleNames(out)).toContain('quote-missing')
})

test('price impact past the band blocks, and the band either side of it is respected', () => {
  const over = checkTrade(
    buy(MEDIAN),
    facts({ quote: { priceImpactPct: '0.023', slippageBps: 50, contextSlot: SLOT } }),
  )
  expect(over.verdict).toBe('block')
  const impact = over.reasons.find((r) => r.rule === 'price-band')
  expect(impact?.observed).toBeCloseTo(2.3, 2)
  expect(impact?.limit).toBe(LIMITS.priceBandPct)
  expect(impact?.unit).toBe('%')

  const at = checkTrade(
    buy(MEDIAN),
    facts({ quote: { priceImpactPct: '0.01', slippageBps: 50, contextSlot: SLOT } }),
  )
  expect(at.verdict).toBe('pass')
})

test('a route quoted with more slippage than the band blocks, and one inside it does not', () => {
  const wide = checkTrade(
    buy(MEDIAN),
    facts({ quote: { priceImpactPct: '0.0027', slippageBps: 500, contextSlot: SLOT } }),
  )
  expect(wide.verdict).toBe('block')
  expect(ruleNames(wide)).toContain('slippage-tolerance')

  const tight = checkTrade(
    buy(MEDIAN),
    facts({
      quote: { priceImpactPct: '0.0027', slippageBps: LIMITS.slippageBps, contextSlot: SLOT },
    }),
  )
  expect(tight.verdict).toBe('pass')
})

test('a category this wallet has never traded blocks, and one it has does not', () => {
  const untraded: JevVerdict = {
    ...jevClean(),
    answers: {
      tokenCategory: { category: 'real-world asset', confidence: 0.8 },
      injection: { looksInjected: false, confidence: 0.9 },
    },
  }
  const out = checkTrade(buy(MEDIAN), facts({ jev: untraded }))
  expect(out.verdict).toBe('block')
  const fit = out.reasons.find((r) => r.rule === 'style-fit')
  expect(fit?.observed).toBe(0)
  expect(fit?.message).toContain('214')
  // The 6 PRD names are phrases, not single words, so the sentence has to hold one without
  // reading "real-world asset tokens" or, worse, "liquid-staking token tokens".
  expect(fit?.message).toContain('in the real-world asset category')

  const traded: JevVerdict = {
    ...jevClean(),
    answers: {
      tokenCategory: { category: 'memecoin', confidence: 0.8 },
      injection: { looksInjected: false, confidence: 0.9 },
    },
  }
  expect(checkTrade(buy(MEDIAN), facts({ jev: traded })).verdict).toBe('pass')
})

test('a stop further out than the habit blocks, and one inside the habit does not', () => {
  const wide = checkTrade(buy(MEDIAN), facts({ proposedStopPct: 8 + STOP_TOLERANCE_POINTS + 1 }))
  expect(wide.verdict).toBe('block')
  const stop = wide.reasons.find((r) => r.rule === 'stop-vs-usual')
  expect(stop?.observed).toBe(11)
  expect(stop?.limit).toBe(10)
  expect(stop?.unit).toBe('%')

  expect(checkTrade(buy(MEDIAN), facts({ proposedStopPct: 9 })).verdict).toBe('pass')
})

test('no mined size rule is unsure, and it says how much history a rule needs', () => {
  const none: MinedRule = {
    kind: 'size',
    found: false,
    value: null,
    sampleSize: 3,
    requiredSampleSize: 1,
    reason: 'no closed trades to size from',
  }
  const out = checkTrade(buy(MEDIAN), facts({ rules: rules({ size: none }) }))
  expect(out.verdict).toBe('unsure')
  const missing = out.reasons.find((r) => r.rule === 'size-rule-missing')
  expect(missing?.message).toContain('3')
})

test('every verdict is stamped with the stalest read behind it and both rule versions', () => {
  const out = checkTrade(
    buy(MEDIAN),
    facts({ quote: { priceImpactPct: '0.0027', slippageBps: 50, contextSlot: SLOT - 4 } }),
  )
  expect(out.dataSlot).toBe(SLOT - 4)
  expect(out.ruleVersion).toBe('check-trade/1+profile-2026-09-24-a')
})

test('the no-model share, measured over F4 own 4 scripted trade kinds', () => {
  // "0 model calls when all guards resolve arithmetically, and the no-model share is measured and
  // reported." The caller skips the Jev call when the arithmetic alone already blocks, so the
  // share is counted by running each kind with `jev: null` and asking whether it reached a block.
  // The production share over real traffic is Benchmark B's line, not this one.
  const kinds: [string, ReturnType<typeof buy>, Partial<TradeFacts>][] = [
    ['over usual size', buy(MEDIAN * 4.1), {}],
    ['past usual stop', buy(MEDIAN), { proposedStopPct: 30 }],
    ['new token outside the usual set', buy(MEDIAN), {}],
    ['normal trade', buy(MEDIAN), {}],
  ]
  const noModel = kinds.filter(
    ([, trade, over]) => checkTrade(trade, facts({ ...over, jev: null })).verdict === 'block',
  )
  expect(noModel.map(([name]) => name)).toEqual(['over usual size', 'past usual stop'])
  expect(noModel).toHaveLength(2)

  // The 2 that do need the model need it for the category, which is one of the 3 non-numeric
  // questions, and never for a number.
  expect(checkTrade(buy(MEDIAN), facts({ jev: null })).verdict).toBe('unsure')
})
