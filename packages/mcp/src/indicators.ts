// Chart indicators, pure: plain arrays in, arrays of the same length out, 0 network calls.
//
// A value that cannot be computed yet (too few points for the period) is null, never 0 and never
// a shorter array, so index i of every output lines up with candle i of the input. The caller
// passes candles as they came: a missing candle is not filled here, and /market names it as a gap.

type Series = (number | null)[]

const nulls = (n: number): Series => Array.from({ length: n }, () => null)

/** Simple moving average over `period` points. */
export function sma(values: readonly number[], period: number): Series {
  const out = nulls(values.length)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!
    if (i >= period) sum -= values[i - period]!
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** Exponential moving average, k = 2 / (period + 1), seeded with the simple average of the first `period` points. */
export function ema(values: readonly (number | null)[], period: number): Series {
  const out = nulls(values.length)
  const k = 2 / (period + 1)
  // Starts at the first non-null input, so MACD can run an EMA over its own leading nulls.
  const start = values.findIndex((v) => v !== null)
  if (start < 0 || values.length - start < period) return out
  let prev = 0
  for (let i = start; i < start + period; i++) prev += values[i]!
  prev /= period
  out[start + period - 1] = prev
  for (let i = start + period; i < values.length; i++) {
    prev = prev + k * (values[i]! - prev)
    out[i] = prev
  }
  return out
}

/** Bollinger bands: the simple average, plus and minus `width` population standard deviations. */
export function bollinger(values: readonly number[], period: number, width: number) {
  const middle = sma(values, period)
  const upper = nulls(values.length)
  const lower = nulls(values.length)
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]!
    let squares = 0
    for (let j = i - period + 1; j <= i; j++) squares += (values[j]! - mean) ** 2
    const sd = Math.sqrt(squares / period)
    upper[i] = mean + width * sd
    lower[i] = mean - width * sd
  }
  return { middle, upper, lower }
}

/** Relative strength index with Wilder's smoothing: (previous * (period - 1) + current) / period. */
export function rsi(values: readonly number[], period: number): Series {
  const out = nulls(values.length)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const at = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l))
  out[period] = at(gain, loss)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = at(gain, loss)
  }
  return out
}

/** MACD: line = EMA(fast) - EMA(slow), signal = EMA(signal) of the line, histogram = line - signal. */
export function macd(values: readonly number[], fast: number, slow: number, signalPeriod: number) {
  const f = ema(values, fast)
  const s = ema(values, slow)
  const line: Series = values.map((_, i) => (f[i] == null || s[i] == null ? null : f[i]! - s[i]!))
  const signal = ema(line, signalPeriod)
  const histogram: Series = line.map((v, i) =>
    v == null || signal[i] == null ? null : v - signal[i]!,
  )
  return { line, signal, histogram }
}

/** Volume as given, with its simple average over `period` candles. */
export function volume(values: readonly number[], period: number) {
  return { values: [...values], ma: sma(values, period) }
}

/**
 * The set /market draws, each with the parameters it was computed with, so a chart can print them
 * beside the line and nobody has to guess whether RSI was 14 or 9.
 */
export function indicators(closes: readonly number[], volumes: readonly number[]) {
  return {
    ma: { params: { period: 20 }, values: sma(closes, 20) },
    ema: { params: { period: 20 }, values: ema(closes, 20) },
    bollinger: {
      params: { period: 20, width: 2, deviation: 'population' },
      ...bollinger(closes, 20, 2),
    },
    rsi: { params: { period: 14, smoothing: 'Wilder' }, values: rsi(closes, 14) },
    macd: { params: { fast: 12, slow: 26, signal: 9 }, ...macd(closes, 12, 26, 9) },
    volume: { params: { maPeriod: 20, unit: 'USD' }, ...volume(volumes, 20) },
  }
}
