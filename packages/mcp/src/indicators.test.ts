import { describe, expect, test } from 'vitest'
import { bollinger, ema, macd, rsi, sma, volume } from './indicators.js'

// The 30-candle fixture, written by hand: a zigzag that climbs 2 and falls 1, so every close is
// easy to sum in your head and RSI sees both gains and losses.
//
//   t      0   1   2   3   4   5   6   7   8   9  10  11  12  13  14
//   close 100 102 101 103 102 104 103 105 104 106 105 107 106 108 107
//   t     15  16  17  18  19  20  21  22  23  24  25  26  27  28  29
//   close 109 108 110 109 111 110 112 111 113 112 114 113 115 114 116
//
// Even t: 100 + t/2. Odd t: 102 + (t - 1)/2. Equivalently close = ramp + wiggle with
// ramp = 100.75 + 0.5 t and wiggle = -0.75 on even t, +0.75 on odd t. Both forms are used below.
const CLOSES = [
  100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107, 109, 108, 110, 109,
  111, 110, 112, 111, 113, 112, 114, 113, 115, 114, 116,
]
// Volumes repeat 100, 200, 300.
const VOLUMES = CLOSES.map((_, t) => 100 * ((t % 3) + 1))

const near = (got: number | null | undefined, want: number) => {
  expect(got).not.toBeNull()
  expect(got as number).toBeCloseTo(want, 9)
}

test('the fixture is the one written out above', () => {
  expect(CLOSES).toHaveLength(30)
  CLOSES.forEach((c, t) => expect(c).toBe(t % 2 === 0 ? 100 + t / 2 : 102 + (t - 1) / 2))
})

describe('MA (simple moving average)', () => {
  test('MA(20) against the hand sums', () => {
    // t = 19 is the first full window, t 0..19:
    //   even closes 100..109 sum to 10 * 100 + (0 + 1 + ... + 9) = 1000 + 45 = 1045
    //   odd closes  102..111 sum to 10 * 102 + 45 = 1065
    //   (1045 + 1065) / 20 = 2110 / 20 = 105.5
    // t = 20 drops close 100 and adds 110: (2110 - 100 + 110) / 20 = 2120 / 20 = 106
    // t = 21 drops 102 and adds 112: 2130 / 20 = 106.5
    // Every later step drops one close and adds one 10 higher, so +0.5 a step: t = 29 gives 110.5.
    const ma = sma(CLOSES, 20)
    expect(ma).toHaveLength(30)
    expect(ma.slice(0, 19).every((v) => v === null)).toBe(true)
    near(ma[19], 105.5)
    near(ma[20], 106)
    near(ma[21], 106.5)
    near(ma[29], 110.5)
  })
})

describe('EMA', () => {
  test('EMA(20), seeded with the MA(20), then k = 2 / 21', () => {
    // t = 19: the seed, MA(20) = 105.5
    // t = 20: 105.5 + (110 - 105.5) * 2/21 = 105.5 + 9/21 = 105.928571428...
    // t = 21: 105.928571 + (112 - 105.928571) * 2/21 = 105.928571 + 0.578231 = 106.506802...
    const e = ema(CLOSES, 20)
    expect(e.slice(0, 19).every((v) => v === null)).toBe(true)
    near(e[19], 105.5)
    near(e[20], 105.5 + 9 / 21)
    near(e[21], 106.50680272108843)
  })
})

describe('Bollinger (20, 2)', () => {
  test('middle is MA(20), bands are 2 population standard deviations away', () => {
    // t = 19, window t 0..19, mean 105.5. close - mean = (0.5 t - 4.75) + wiggle.
    //   variance of 0.5 t over t 0..19:    0.25 * (20^2 - 1) / 12 = 0.25 * 33.25 = 8.3125
    //   variance of the wiggle (+-0.75):   0.5625
    //   covariance: sum of 0.5 t * wiggle / 20 = 0.5 * 0.75 * 10 / 20 = 0.1875
    //   (sum of t * (+1 odd, -1 even) for t 0..19 is 10; the wiggle has mean 0)
    //   variance = 8.3125 + 0.5625 + 2 * 0.1875 = 9.25, sd = sqrt(9.25) = 3.041381265...
    //   upper = 105.5 + 2 * 3.041381 = 111.582762..., lower = 99.417237...
    const b = bollinger(CLOSES, 20, 2)
    expect(b.middle[18]).toBeNull()
    expect(b.upper[18]).toBeNull()
    near(b.middle[19], 105.5)
    near(b.upper[19], 105.5 + 2 * Math.sqrt(9.25))
    near(b.lower[19], 105.5 - 2 * Math.sqrt(9.25))
    // t = 29 is the same shape 5 units higher: mean 110.5, same variance.
    near(b.upper[29], 110.5 + 2 * Math.sqrt(9.25))
  })
})

describe('RSI (14), Wilder smoothing', () => {
  test('against the hand values at t 14, 15 and 16', () => {
    // Changes alternate +2 (into odd t) and -1 (into even t).
    // t = 14 uses the 14 changes into t 1..14: 7 gains of 2 and 7 losses of 1.
    //   average gain = 14 / 14 = 1, average loss = 7 / 14 = 0.5
    //   RS = 1 / 0.5 = 2, RSI = 100 - 100 / (1 + 2) = 66.666...
    // t = 15, change +2:
    //   gain = (1 * 13 + 2) / 14 = 15/14, loss = (0.5 * 13 + 0) / 14 = 6.5/14
    //   RS = 15 / 6.5 = 30/13, RSI = 100 - 100 / (43/13) = 100 - 1300/43 = 69.767441...
    // t = 16, change -1:
    //   gain = (15/14 * 13) / 14 = 195/196, loss = (6.5/14 * 13 + 1) / 14 = 98.5/196
    //   RS = 195 / 98.5 = 390/197, RSI = 100 - 100 / (587/197) = 100 - 19700/587 = 66.439522...
    const r = rsi(CLOSES, 14)
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true)
    near(r[14], 100 - 100 / 3)
    near(r[15], 100 - 1300 / 43)
    near(r[16], 100 - 19700 / 587)
  })

  test('no losses in the window reads 100, not a division by zero', () => {
    const up = Array.from({ length: 16 }, (_, t) => 10 + t)
    expect(rsi(up, 14)[15]).toBe(100)
  })
})

describe('MACD (12, 26, 9)', () => {
  test('the line at t 25 on the fixture', () => {
    // EMA is linear and the MA seed is linear, so EMA(close) = EMA(ramp) + EMA(wiggle).
    //
    // EMA(26) at t = 25 is its seed, the MA of t 0..25: even closes 100..112 sum to 1378, odd
    // closes 102..114 sum to 1404, (1378 + 1404) / 26 = 2782 / 26 = 107.
    //
    // EMA(12) at t = 25:
    //   ramp part: an EMA seeded with the MA lags a ramp of slope b by b (p - 1) / 2 from its
    //   first value on, so 100.75 + 0.5 * 25 - 0.5 * 11 / 2 = 113.25 - 2.75 = 110.5.
    //   wiggle part: seeded at t = 11 with the mean of 12 alternating values, 0. Then 14 steps
    //   with k = 2/13 of E(t) = (1 - k) E(t - 1) + k w(t), w(t) = 0.75 (-1)^(t+1). Summing the
    //   geometric series: E(25) = k * 0.75 * (1 - (k - 1)^14) / (2 - k)
    //                           = (2/13) * 0.75 * (1 - (11/13)^14) / (24/13)
    //                           = 0.0625 * (1 - 0.0964448...) = 0.0564720...
    //   EMA(12) = 110.5564720...
    // MACD line = 110.5564720 - 107 = 3.5564720...
    const m = macd(CLOSES, 12, 26, 9)
    expect(m.line[24]).toBeNull()
    near(m.line[25], 110.5 + 0.0625 * (1 - (11 / 13) ** 14) - 107)
    // The signal needs 9 line values, the first at t = 33: 30 candles is too few, so null, not 0.
    expect(m.signal.every((v) => v === null)).toBe(true)
    expect(m.histogram.every((v) => v === null)).toBe(true)
  })

  test('on a ramp of slope 1 the line is 7, the signal 7 and the histogram 0', () => {
    // Using the ramp lag above: EMA(12) lags 11/2, EMA(26) lags 25/2, the line is 25/2 - 11/2 = 7
    // from t = 25, so the signal (EMA 9 of a constant 7) is 7 from t = 33.
    const ramp = Array.from({ length: 40 }, (_, t) => 50 + t)
    const m = macd(ramp, 12, 26, 9)
    near(m.line[25], 7)
    expect(m.signal[32]).toBeNull()
    near(m.signal[33], 7)
    near(m.histogram[39], 0)
  })
})

describe('volume', () => {
  test('volume with its MA(20)', () => {
    // t 0..19 holds seven 100s (t = 0, 3, ..., 18), seven 200s and six 300s:
    // (700 + 1400 + 1800) / 20 = 3900 / 20 = 195
    const v = volume(VOLUMES, 20)
    expect(v.values).toEqual(VOLUMES)
    near(v.ma[19], 195)
  })
})

test('too few values give nulls of the same length, never a short array', () => {
  expect(sma([1, 2], 20)).toEqual([null, null])
  expect(ema([], 20)).toEqual([])
  expect(rsi([1, 2, 3], 14)).toEqual([null, null, null])
})
