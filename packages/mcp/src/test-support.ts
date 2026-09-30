import { liveIo, type BuiltSwap, type ToolIo, type VaultRules } from './io.js'

// Shared by this package's own tests (token-budget.token.test.ts, third-party-client.test.ts).
// Not part of the package's public API.
//
// Typed loosely on purpose: `callAsTool` returns the SDK's `CallToolResult`, but the SDK client's
// `callTool()` widens that to a union that also covers the pre-2024-10-07 "toolResult" shape with
// no `content` field. Neither this package nor any tool it registers ever produces that shape, so
// the check is a runtime one, the same trust boundary the rest of this file's callers cross when
// they parse `text` as JSON.
export const textOf = (result: unknown): string => {
  const content = (result as { content?: unknown } | undefined)?.content
  const block = (content as Array<{ type?: unknown; text?: unknown }> | undefined)?.[0]
  if (block === undefined || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('expected a text content block, got: ' + JSON.stringify(block))
  }
  return block.text
}

/**
 * The live io with its chain read replaced, so a test can call list_rules without a chain. Every
 * other read stays live, which keeps the replay tests exactly as they were.
 */
export const withChain = (vaultRules: VaultRules): ToolIo => ({
  ...liveIo(),
  loadVaultRules: async () => vaultRules,
  findHirers: async () => [],
})

// prepare_swap's chain and Jupiter, faked; check_trade stays real, on the recorded wallet.
const WSOL = 'So11111111111111111111111111111111111111112'
const AGENT = 'DNDYmqxubRKmMtnq88AW4aUHreu88XrrGijAKpUojw1A'
export const SWAP_VAULT = '5wLUez6exk7owNcQbVDGoVn22NDkDro42HAvZyEZfQBN'
const MEDIAN = '400000'
/** A Raydium CLMM SOL/USDC pool, as Jupiter names a leg of its route. */
export const POOL = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj'
const RECORDED = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** A buy at the recorded wallet's median, the 1 trade the replayed check passes. */
export const SWAP = {
  owner: RECORDED,
  historyWallet: RECORDED,
  agent: AGENT,
  inputMint: WSOL,
  outputMint: USDC,
  amount: MEDIAN,
  slippageBps: 50,
}

export const quoteFor = (amount: string, priceImpactPct = '0.0001') => ({
  inAmount: amount,
  outAmount: '76000',
  otherAmountThreshold: '75620',
  slippageBps: 50,
  priceImpactPct,
  contextSlot: 450115322,
  inputMint: WSOL,
  outputMint: USDC,
  routePlan: [{ swapInfo: { ammKey: POOL, label: 'Raydium CLMM' } }],
})

/** A vault holding 1 agent role on wSOL with `remaining` left, and a record of what was called. */
export const swapIo = (remaining: bigint, over: Partial<ToolIo> = {}) => {
  const calls: string[] = []
  const built: BuiltSwap = {
    vault: SWAP_VAULT,
    transaction: 'AQAB',
    lastValidBlockHeight: 430000000,
    unitsConsumed: 112000,
    failure: null,
    outputGained: 75900n,
  }
  const io: ToolIo = {
    ...liveIo(),
    loadVaultRules: async () => {
      calls.push('vault')
      return {
        owner: SWAP.owner,
        vault: SWAP_VAULT,
        rules: [
          {
            roleId: 1,
            authority: AGENT,
            mint: WSOL,
            amount: 500000000n,
            windowSlots: 150n,
            effectiveRemaining: remaining,
            rollingWorstCase: 1000000000n,
          },
        ],
      }
    },
    loadQuote: async (q) => {
      calls.push('quote')
      return quoteFor(q.amount)
    },
    buildSwap: async () => {
      calls.push('build')
      return built
    },
    ...over,
  }
  return { io, calls }
}
