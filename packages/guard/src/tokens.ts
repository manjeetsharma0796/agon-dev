// Token category and impersonation as lookups, not a model (measured in T-F11b: on 140
// labelled cases of real token text no Jev question design both passed real tokens and stopped
// attacks). Everything here is pinned in code and changes only by a PR; nothing is read from user
// input. The mints were taken from Jupiter's verified token list on 2026-09-29.

import type { TokenCategory } from './jev/index.js'

/**
 * The main Solana protocol and wrapped tokens counted as blue chip, beside anything Jupiter tags
 * `major`. A short list on purpose: "blue chip" against "other" is a definition, not a fact, and
 * market cap does not separate them (RENDER at $937M is not here, ORCA at $100M is).
 */
const BLUE_CHIPS: ReadonlySet<string> = new Set([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // Jupiter
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // Raydium
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // Pyth Network
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // Jito
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // Orca
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', // Coinbase Wrapped BTC
])

/**
 * Well-known tokens and the only mint allowed to carry each name and symbol. A different mint
 * using one of these is the impostor pattern: "USD Coin" on a mint that is not Circle's.
 */
export const MAJORS: readonly { mint: string; symbol: string; name: string }[] = [
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin' },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'USDT' },
  { mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', symbol: 'PYUSD', name: 'PayPal USD' },
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL' },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter' },
  { mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY', name: 'Raydium' },
  { mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH', name: 'Pyth Network' },
  { mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', symbol: 'JTO', name: 'JITO' },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk' },
  {
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    symbol: 'JitoSOL',
    name: 'Jito Staked SOL',
  },
]

/** Jupiter's tags for 1 token, as the lookup returned them. */
export interface TokenListing {
  symbol: string | null
  name: string | null
  tags: readonly string[]
}

/** The category, first match wins, in the order that makes the overlaps come out right. */
export function categoryOf(mint: string, listing: TokenListing): TokenCategory {
  const tags = new Set(listing.tags)
  if (tags.has('stable')) return 'stablecoin'
  if (tags.has('lst')) return 'liquid-staking token'
  if (tags.has('rwa') || tags.has('yb')) return 'real-world asset'
  if (tags.has('meme')) return 'memecoin'
  if (tags.has('major') || BLUE_CHIPS.has(mint)) return 'blue chip'
  return 'other'
}

const norm = (s: string | null): string => (s ?? '').replace(/^\$/, '').trim().toLowerCase()

/** The major this mint is pretending to be, or null. Matches on symbol or name, never on mint. */
export function impersonates(mint: string, listing: TokenListing): (typeof MAJORS)[number] | null {
  const symbol = norm(listing.symbol)
  const name = norm(listing.name)
  return (
    MAJORS.find(
      (m) =>
        m.mint !== mint &&
        ((symbol !== '' && symbol === norm(m.symbol)) || (name !== '' && name === norm(m.name))),
    ) ?? null
  )
}
