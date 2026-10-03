import { PublicKey } from '@solana/web3.js'
import { describe, expect, test } from 'vitest'
import {
  clAmount,
  clLadder,
  cpMoves,
  createDepth,
  flip,
  lineSegments,
  ordersLadder,
  readManifest,
  walkTicks,
  type Accounts,
} from './depth.js'

const SOL = 'So11111111111111111111111111111111111111112'
const MINT = 'FHpcNSe6tb2n15bAdq4BkeYWGyZKFD7yLYrH92ng7wCT'
const PUMPSWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const sqrtOf = (tick: number) => 1.0001 ** (tick / 2)

describe('constant product, x times y equals k', () => {
  // By hand: x = 100 base, y = 10,000 quote, so k = 1,000,000 and the price is y / x = 100.
  //
  // A buy that lifts the price 21%: the new price is 121 = y' / x' and x' * y' = k, so
  // x' = sqrt(k / 121) = 1,000 / 11 = 90.909 and y' = sqrt(k * 121) = 11,000.
  // The buyer pays y' - y = 1,000 quote and takes x - x' = 9.0909 base.
  // Check: 90.909 * 11,000 = 1,000,000 = k, and 11,000 / 90.909 = 121.
  //
  // A sell that drops the price 19%: the new price is 81, so y' = sqrt(k * 81) = 9,000 and
  // x' = sqrt(k / 81) = 111.111. The seller puts in 11.111 base and takes 1,000 quote.
  // Check: 111.111 * 9,000 = 1,000,000 = k, and 9,000 / 111.111 = 81.
  test('a 21% buy costs 1,000 quote for 9.09 base and a 19% sell pays 1,000 quote for 11.11 base', () => {
    const { moves, unreachable } = cpMoves(100, 10_000, 1, {}, [21, 19])
    const buy = moves.find((m) => m.side === 'buy' && m.pct === 21)!
    const sell = moves.find((m) => m.side === 'sell' && m.pct === 19)!
    expect(buy.quoteIn).toBeCloseTo(1_000, 9)
    expect(buy.baseOut).toBeCloseTo(100 - 1_000 / 11, 9)
    expect(sell.quoteIn).toBeCloseTo(1_000, 9)
    expect(sell.baseOut).toBeCloseTo(1_000 / 9 - 100, 9)
    expect(unreachable).toEqual([])
  })

  // The 4 the screen shows, by hand on the same pool: a 1% buy pays y(sqrt(1.01) - 1) =
  // 10,000 * 0.0049876 = 49.876 quote; a 10% sell pays y(1 - sqrt(0.9)) = 10,000 * 0.0513167 =
  // 513.167 quote. Quote is priced at $2 here, so the USD figures double.
  test('1, 2, 5 and 10% each side, with the quote side in USD', () => {
    const { moves } = cpMoves(100, 10_000, 2)
    expect(moves.map((m) => `${m.side} ${m.pct}`)).toEqual([
      'buy 1',
      'buy 2',
      'buy 5',
      'buy 10',
      'sell 1',
      'sell 2',
      'sell 5',
      'sell 10',
    ])
    expect(moves[0]!.quoteIn).toBeCloseTo(2 * 49.87562, 4)
    expect(moves[7]!.quoteIn).toBeCloseTo(2 * 513.16702, 4)
    // After every move the product is still k.
    for (const m of moves) {
      const x = m.side === 'buy' ? 100 - m.baseOut : 100 + m.baseOut
      const y = m.side === 'buy' ? 10_000 + m.quoteIn / 2 : 10_000 - m.quoteIn / 2
      expect(x * y).toBeCloseTo(1_000_000, 6)
    }
  })

  test('a move the curve cannot fill is left out and named', () => {
    // 9.09 base out for a 21% buy, and only 5 base really there.
    const { moves, unreachable } = cpMoves(100, 10_000, 1, { baseOut: 5 }, [21])
    expect(moves.map((m) => m.side)).toEqual(['sell'])
    expect(unreachable[0]).toMatch(/21% buy needs 9\.09 base .* only 5 /)
  })
})

describe('concentrated liquidity to token amounts', () => {
  // By hand: L = 1,000 between sqrt prices 1 and 2 (prices 1 to 4).
  // token0 = L (1/sqrt(pa) - 1/sqrt(pb)) = 1,000 (1 - 1/2) = 500
  // token1 = L (sqrt(pb) - sqrt(pa)) = 1,000 (2 - 1) = 1,000
  // The average price 1,000 / 500 = 2 is the geometric mean of 1 and 4, as it must be.
  test('L 1,000 from price 1 to 4 holds 500 of token0 and 1,000 of token1', () => {
    const segs = [{ lo: 1, hi: 2, L: 1_000 }]
    expect(clAmount(segs, 1, 2, true)).toBeCloseTo(500, 9)
    expect(clAmount(segs, 1, 2, false)).toBeCloseTo(1_000, 9)
    // Only the overlap counts.
    expect(clAmount(segs, 0.5, 1.5, false)).toBeCloseTo(500, 9)
    expect(clAmount(segs, 3, 4, true)).toBe(0)
  })

  // By hand, L = 1,000 from sqrt 0.5 to 2 and the price at 1, buckets of 21% of mid:
  // ask bucket 1 is price 1 to 1.21, sqrt 1 to 1.1: token0 = 1,000 (1 - 1/1.1) = 90.909
  // bid bucket 1 is price 0.79 to 1, sqrt 0.88882 to 1: token0 = 1,000 (1/0.88882 - 1) = 125.09
  test('the ladder holds the token0 amounts in each bucket, priced at its far edge in USD', () => {
    const ladder = clLadder({
      segments: [{ lo: 0.5, hi: 2, L: 1_000 }],
      sqrtMid: 1,
      baseIsToken0: true,
      dec0: 0,
      dec1: 0,
      usdPerQuote: 2,
      width: 0.21,
      levels: 2,
    })
    expect(ladder.mid).toBe(2)
    expect(ladder.asks[0]!.price).toBeCloseTo(2.42, 9)
    expect(ladder.asks[0]!.size).toBeCloseTo(1_000 * (1 - 1 / 1.1), 6)
    expect(ladder.bids[0]!.price).toBeCloseTo(1.58, 9)
    expect(ladder.bids[0]!.size).toBeCloseTo(1_000 * (1 / Math.sqrt(0.79) - 1), 6)
    // Cumulative from mid outward.
    expect(ladder.asks[1]!.total).toBeCloseTo(ladder.asks[0]!.size + ladder.asks[1]!.size, 9)
  })

  test('with the mint as token1 the sides swap and the amounts are token1', () => {
    // Base price 1/p. Base asks run p down: price 1 to 1.21 is p 1/1.21 to 1, sqrt 1/1.1 to 1,
    // token1 = 1,000 (1 - 1/1.1) = 90.909.
    const ladder = clLadder({
      segments: [{ lo: 0.5, hi: 2, L: 1_000 }],
      sqrtMid: 1,
      baseIsToken0: false,
      dec0: 0,
      dec1: 0,
      usdPerQuote: 1,
      width: 0.21,
      levels: 1,
    })
    expect(ladder.asks[0]!.size).toBeCloseTo(1_000 * (1 - 1 / 1.1), 6)
  })

  test('decimals scale price and size', () => {
    // SOL (9) against USDC (6): raw p 0.1 is 0.1 * 10^3 = 100 USDC per SOL.
    const ladder = clLadder({
      segments: [{ lo: 0.2, hi: 0.4, L: 1e12 }],
      sqrtMid: Math.sqrt(0.1),
      baseIsToken0: true,
      dec0: 9,
      dec1: 6,
      usdPerQuote: 1,
      width: 0.01,
      levels: 1,
    })
    expect(ladder.mid).toBeCloseTo(100, 9)
    // 1e12 (1/sqrt(0.1) - 1/sqrt(0.101)) raw lamports, over 10^9.
    expect(ladder.asks[0]!.size).toBeCloseTo(
      (1e12 * (1 / Math.sqrt(0.1) - 1 / Math.sqrt(0.101))) / 1e9,
      6,
    )
  })
})

describe('tick walks', () => {
  test('crossing a tick up adds its net, crossing one down takes it away', () => {
    // Current tick 5, L 100. Tick 10 adds 50 going up. Tick 0 is at or below the current one,
    // so going down past it takes its net of 30 away.
    const segs = walkTicks({
      tick: 5,
      liquidity: 100,
      sqrtPrice: sqrtOf(5),
      ticks: [
        { index: 0, net: 30 },
        { index: 10, net: 50 },
      ],
      lowTick: -20,
      highTick: 20,
    })
    const at = (tick: number) => segs.find((s) => s.lo <= sqrtOf(tick) && sqrtOf(tick) < s.hi)!.L
    expect(at(-10)).toBe(70)
    expect(at(3)).toBe(100)
    expect(at(7)).toBe(100)
    expect(at(15)).toBe(150)
  })

  test('liquidity going below 0 is a broken read, not a book', () => {
    expect(() =>
      walkTicks({
        tick: 0,
        liquidity: 10,
        sqrtPrice: 1,
        ticks: [{ index: 4, net: -20 }],
        lowTick: -8,
        highTick: 8,
      }),
    ).toThrow(/below 0 at tick 4/)
  })

  test("Raydium's position line becomes segments, checked against the pool account", () => {
    const line = {
      success: true,
      data: {
        line: [
          { price: 0, liquidity: '10', tick: -100 },
          { price: 1, liquidity: '30', tick: 0 },
          { price: 2, liquidity: '0', tick: 100 },
        ],
      },
    }
    const segs = lineSegments(line, 50, 30n)
    expect(segs).toEqual([
      { lo: sqrtOf(-100), hi: sqrtOf(0), L: 10 },
      { lo: sqrtOf(0), hi: sqrtOf(100), L: 30 },
    ])
    expect(() => lineSegments(line, 50, 31n)).toThrow(/reads L 30 at tick 50 .* 31/)
    expect(() => lineSegments({ data: { line: [{ tick: 'x' }] } }, 0, 1n)).toThrow(/1 of 1 points/)
  })
})

describe('order ladders', () => {
  test('a real book groups by exact price, best first, 20 a side at most', () => {
    const orders = [
      { price: 101, size: 1, side: 'ask' as const },
      { price: 102, size: 2, side: 'ask' as const },
      { price: 101, size: 3, side: 'ask' as const },
      { price: 99, size: 4, side: 'bid' as const },
      ...Array.from({ length: 30 }, (_, i) => ({ price: 90 - i, size: 1, side: 'bid' as const })),
    ]
    const l = ordersLadder(orders, null, 1)
    expect(l.mid).toBe(100)
    expect(l.asks).toEqual([
      { price: 101, size: 4, total: 4 },
      { price: 102, size: 2, total: 6 },
    ])
    expect(l.bids[0]).toEqual({ price: 99, size: 4, total: 4 })
    expect(l.bids).toHaveLength(20)
  })

  test('bins bucket by width from mid, priced at the far edge', () => {
    const orders = [
      { price: 100, size: 1, side: 'ask' as const },
      { price: 100.4, size: 2, side: 'ask' as const },
      { price: 100.6, size: 3, side: 'ask' as const },
      { price: 99.7, size: 5, side: 'bid' as const },
    ]
    const l = ordersLadder(orders, 100, 2, 0.005)
    expect(l.mid).toBe(200)
    expect(l.asks).toEqual([
      { price: expect.closeTo(201, 9), size: 3, total: 3 },
      { price: expect.closeTo(202, 9), size: 3, total: 6 },
    ])
    expect(l.bids).toEqual([{ price: expect.closeTo(199, 9), size: 5, total: 5 }])
  })

  test('flipping a book to the other token keeps the value on each side', () => {
    // An ask of 2 X at 4 Y each is a bid for 8 Y at 0.25 X each.
    expect(flip([{ price: 4, size: 2, side: 'ask' }])).toEqual([
      { price: 0.25, size: 8, side: 'bid' },
    ])
  })
})

describe('Manifest market accounts', () => {
  // A market built by hand in the layout of CKS-Systems/manifest client/ts: 256 bytes of
  // MarketFixed, then 80-byte nodes (16 of red-black header, 64 of RestingOrder).
  const NIL = 0xffffffff
  function market(
    orders: { price: number; atoms: bigint; bid: boolean; lastValidSlot?: number }[],
  ) {
    const d = Buffer.alloc(256 + 80 * orders.length)
    d.writeBigUInt64LE(4859840929024028656n, 0)
    d[9] = 9 // base decimals
    d[10] = 6 // quote decimals
    new PublicKey(SOL).toBuffer().copy(d, 16)
    new PublicKey(MINT).toBuffer().copy(d, 48)
    const roots = { bid: NIL, ask: NIL }
    const last = { bid: NIL, ask: NIL }
    orders.forEach((o, i) => {
      const at = i * 80
      const side = o.bid ? 'bid' : 'ask'
      // A chain: each new node is the right child of the previous one on its side.
      d.writeUInt32LE(NIL, 256 + at)
      d.writeUInt32LE(NIL, 256 + at + 4)
      d.writeUInt32LE(last[side], 256 + at + 8)
      if (last[side] !== NIL) d.writeUInt32LE(at, 256 + last[side] + 4)
      else roots[side] = at
      last[side] = at
      // Price: quote atoms per base atom times 10^18. 100 USDC per SOL is 0.1 atoms per atom.
      const raw = BigInt(Math.round(o.price * 1e3)) * 10n ** 12n
      d.writeBigUInt64LE(raw & 0xffffffffffffffffn, 256 + at + 16)
      d.writeBigUInt64LE(raw >> 64n, 256 + at + 24)
      d.writeBigUInt64LE(o.atoms, 256 + at + 32)
      d.writeUInt32LE(o.lastValidSlot ?? 0, 256 + at + 52)
      d[256 + at + 56] = o.bid ? 1 : 0
    })
    d.writeUInt32LE(roots.bid, 156)
    d.writeUInt32LE(roots.ask, 164)
    d.writeUInt32LE(NIL, 172)
    return d
  }

  test('reads bids and asks with their prices and sizes, and drops expired orders', () => {
    const m = readManifest(
      market([
        { price: 99.5, atoms: 2_000_000_000n, bid: true },
        { price: 100.5, atoms: 1_500_000_000n, bid: false },
        { price: 101, atoms: 1_000_000_000n, bid: false, lastValidSlot: 10 },
        { price: 99, atoms: 3_000_000_000n, bid: true, lastValidSlot: 2_000 },
        // Valid through its last valid slot: the program expires it only once the slot is past.
        { price: 98, atoms: 1_000_000_000n, bid: true, lastValidSlot: 1_000 },
      ]),
      1_000,
    )
    expect(m.baseMint).toBe(SOL)
    expect(m.quoteMint).toBe(MINT)
    expect(m.expired).toBe(1)
    expect(m.orders).toEqual([
      { price: 99.5, size: 2, side: 'bid' },
      { price: 99, size: 3, side: 'bid' },
      { price: 98, size: 1, side: 'bid' },
      { price: 100.5, size: 1.5, side: 'ask' },
    ])
  })

  test('a tree that loops is refused, not walked forever', () => {
    const d = market([{ price: 99.5, atoms: 1n, bid: true }])
    d.writeUInt32LE(0, 256 + 4) // the root's right child is itself
    expect(() => readManifest(d, 1)).toThrow(/node at byte 0 .* twice/)
  })
})

describe('reading a pool', () => {
  const POOL = 'AmdUDqDP7YR9z8CDVUUyQAWKcFgmskXbydxmtP5PUwwD'
  const BASE_VAULT = '7UYTFE4y1kC4LBLkLXxp1gmheiVPhVkFXggfEbo1Eikt'
  const QUOTE_VAULT = '6RBg6W7jNn2FspqbTV36L6Ue1EueTcwrW4vA3XgPmCM3'
  const key = (a: string) => new PublicKey(a).toBuffer()
  const pumpswap = () => {
    const d = Buffer.alloc(301)
    Buffer.from('f19a6d0411b16dbc', 'hex').copy(d, 0)
    key(MINT).copy(d, 43)
    key(SOL).copy(d, 75)
    key(BASE_VAULT).copy(d, 139)
    key(QUOTE_VAULT).copy(d, 171)
    return d
  }
  const mint = (decimals: number) => {
    const d = Buffer.alloc(82)
    d[44] = decimals
    d[45] = 1
    return d
  }
  const vault = (holds: string, amount: bigint) => {
    const d = Buffer.alloc(165)
    key(holds).copy(d, 0)
    d.writeBigUInt64LE(amount, 64)
    return d
  }
  const chain: Accounts = async (addresses) => ({
    slot: 452_000_000,
    list: addresses.map((a) => {
      if (a === POOL) return { owner: PUMPSWAP, data: pumpswap() }
      if (a === MINT) return { owner: SPL, data: mint(6) }
      if (a === SOL) return { owner: SPL, data: mint(9) }
      if (a === BASE_VAULT) return { owner: SPL, data: vault(MINT, 1_000_000_000_000n) }
      if (a === QUOTE_VAULT) return { owner: SPL, data: vault(SOL, 10_000_000_000n) }
      return null
    }),
  })
  const usd = async () => ({ usd: 100, at: '2026-10-03T00:00:00.000Z' })

  test('a constant product pool is the cost to move the price, stamped with its slot', async () => {
    const depth = createDepth({ accounts: chain, getJson: async () => null, usd })
    const book = await depth.book(POOL, MINT)
    // 1,000,000 tokens against 10 SOL at $100: mid 10 * 100 / 1,000,000 = $0.001.
    expect(book).toMatchObject({
      kind: 'amm-curve',
      label: 'Cost to move the price',
      venue: 'PumpSwap',
      pool: POOL,
      slot: 452_000_000,
      bids: [],
      asks: [],
    })
    expect(book.mid).toBeCloseTo(0.001, 12)
    expect(book.moves).toHaveLength(8)
    // A 1% buy: 10 SOL (sqrt(1.01) - 1) = 0.049876 SOL = $4.9876.
    expect(book.moves[0]!.quoteIn).toBeCloseTo(4.98756, 4)
  })

  test('a mint that is not in the pool, and a program we do not read, say so', async () => {
    const depth = createDepth({ accounts: chain, getJson: async () => null, usd })
    await expect(depth.book(POOL, BASE_VAULT)).rejects.toThrow(/holds .* not the mint/)
    const other: Accounts = async (a) => ({
      slot: 1,
      list: a.map(() => ({ owner: SOL, data: Buffer.alloc(8) })),
    })
    await expect(
      createDepth({ accounts: other, getJson: async () => null, usd }).book(POOL, MINT),
    ).rejects.toThrow(/owned by program So111.*, which this server does not read/)
  })
})
