import { expect, test } from 'vitest'
import type { ClosedTrade } from '@agon/decoder'
import { categoryMix } from './category-mix.js'

const Q = 'So11111111111111111111111111111111111111112'
const closed = (mint: string, quoteMint = Q): ClosedTrade => ({
  mint,
  quoteMint,
  soldAmount: '1',
  costBasis: '100',
  proceeds: '110',
  realisedPnl: '10',
  openedSlot: 1,
  closedSlot: 2,
  closedBySignature: 'sig',
})

test('the mix is each category share of closed trades, summing to 1', () => {
  const trades = [closed('A'), closed('A'), closed('B'), closed('C')]
  const cats = new Map([
    ['A', 'memecoin'],
    ['B', 'memecoin'],
    ['C', 'stablecoin'],
  ])
  const mix = categoryMix(trades, Q, cats)
  expect(mix).toEqual({ memecoin: 0.75, stablecoin: 0.25 })
  expect(Object.values(mix ?? {}).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3)
})

test('a traded mint with no category leaves the whole mix absent rather than partial', () => {
  // A partial mix would read as "you have never traded that kind" for the share nobody placed.
  const mix = categoryMix([closed('A'), closed('B')], Q, new Map([['A', 'memecoin']]))
  expect(mix).toBeNull()
})

test('only trades against the quote asset count, like every other mined rule', () => {
  const mix = categoryMix(
    [closed('A'), closed('B', 'other-quote')],
    Q,
    new Map([['A', 'blue chip']]),
  )
  expect(mix).toEqual({ 'blue chip': 1 })
})

test('no closed trades is no mix, not an empty one', () => {
  expect(categoryMix([], Q, new Map())).toBeNull()
})
