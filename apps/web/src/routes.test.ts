import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CheckTradeOutput, Report } from '@agon/core'
import { armRoute, checkTradeRoute, reportRoute, ruleFeedbackRoute } from './routes.js'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TRADE = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  side: 'buy',
  size: '3200000000',
  wallet: WALLET,
}
const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body) })

/** res.json() is `any` widened to unknown by our strict config, and every read of it below is a
 *  field this route is contracted to return, so the shape is asserted once here. */
const jsonOf = async (res: Response): Promise<Record<string, string>> =>
  (await res.json()) as Record<string, string>

test('leg 1 over HTTP: a pasted address comes back as a contract-valid report', async () => {
  const res = await reportRoute(new Request(`https://agon.test/api/report?wallet=${WALLET}`))
  expect(res.status).toBe(200)
  const body = await jsonOf(res)
  expect(() => Report.parse(body)).not.toThrow()
  expect(body.wallet).toBe(WALLET)
})

test('leg 2 over HTTP: check_trade comes back as a contract-valid verdict', async () => {
  const res = await checkTradeRoute(post('https://agon.test/api/check-trade', TRADE))
  expect(res.status).toBe(200)
  const verdict = await res.json()
  expect(() => CheckTradeOutput.parse(verdict)).not.toThrow()
})

test('leg 3 over HTTP: off the fork, arming refuses with 503 and says why', async () => {
  // 503 and not 400: the request is fine and nothing is broken, arming is off on this network.
  // Anything that can move funds fails closed. No AGON_NETWORK is set here, so it is not the fork.
  const res = await armRoute(
    post('https://agon.test/api/arm', {
      wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      mints: ['So11111111111111111111111111111111111111112'],
      triggerType: 'stop',
      expiresAt: null,
    }),
  )
  expect(res.status).toBe(503)
  const body = await jsonOf(res)
  expect(body.code).toBe('not-armable')
  expect(body.error).toContain('practice fork only')
})

test('leg 3 over HTTP: a request that carries a cap is a 400, never an armed limit', async () => {
  const res = await armRoute(
    post('https://agon.test/api/arm', {
      wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      mints: ['So11111111111111111111111111111111111111112'],
      cap: { mint: 'So11111111111111111111111111111111111111112', amount: '1', windowSeconds: 60 },
      triggerType: 'stop',
      expiresAt: null,
    }),
  )
  expect(res.status).toBe(400)
})

test('a bad address is a 400 that names the cause, not a 500', async () => {
  const res = await reportRoute(new Request('https://agon.test/api/report?wallet=nope'))
  expect(res.status).toBe(400)
  const body = await jsonOf(res)
  expect(body.error).toContain('Solana address')
  expect(body.detail ?? '', 'a 400 with no detail is a blank field').not.toBe('')
})

test('a body that is not JSON is a 400, not a crash', async () => {
  const res = await checkTradeRoute(
    new Request('https://agon.test/api/check-trade', { method: 'POST', body: 'not json' }),
  )
  expect(res.status).toBe(400)
})

describe('the rule question', () => {
  const ask = (body: unknown) =>
    ruleFeedbackRoute(
      new Request('https://agon.test/api/rule-feedback', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )

  test('an answer is stored, and the 3 allowed answers are the only ones', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agon-fb-')), 'answers.jsonl')
    process.env['AGON_FEEDBACK_FILE'] = file
    try {
      for (const answer of ['yes', 'no', 'partly']) {
        const res = await ask({ wallet: WALLET, answer })
        expect(res.status, answer).toBe(200)
      }
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(3)
      expect(lines.map((l) => (JSON.parse(l) as { answer: string }).answer)).toEqual([
        'yes',
        'no',
        'partly',
      ])
      expect((await ask({ wallet: WALLET, answer: 'maybe' })).status).toBe(400)
      expect((await ask({ wallet: 'nope', answer: 'yes' })).status).toBe(400)
    } finally {
      delete process.env['AGON_FEEDBACK_FILE']
    }
  })

  test('with nowhere to store it, the answer is refused rather than dropped', async () => {
    // CP3's gate is a percentage of these answers. Accepting one and losing it makes the gate
    // unmeasurable and nobody finds out until the checkpoint.
    delete process.env['AGON_FEEDBACK_FILE']
    const res = await ask({ wallet: WALLET, answer: 'yes' })
    expect(res.status).toBe(503)
    const body = await jsonOf(res)
    expect(body.code).toBe('no-feedback-store')
    expect(body.error).toContain('not recorded')
  })
})

test('a server-side failure is not blamed on the caller', async () => {
  // Found by deleting fixtures/contracts and asking for a report: a valid address came back as
  // "That is not a valid Solana address." with a 400, and the real cause sat in detail where
  // nothing reads it. A beta user would have gone and checked their wallet.
  const { default: fs } = await import('node:fs')
  const dir = new URL('../../../fixtures/contracts/', import.meta.url)
  const file = new URL('report.json', dir)
  const saved = fs.readFileSync(file, 'utf8')
  fs.rmSync(file)
  try {
    const res = await reportRoute(
      new Request('https://x/api/report?wallet=HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'),
    )
    const body = (await res.json()) as { error: string; detail: string }
    expect(res.status, 'a missing fixture is our fault, not a bad request').toBe(500)
    expect(body.error).not.toContain('not a valid')
    expect(body.detail).toContain('fixture is missing')
  } finally {
    fs.writeFileSync(file, saved)
  }
})

test('a genuinely bad address is still the caller fault', async () => {
  const res = await reportRoute(new Request('https://x/api/report?wallet=nope'))
  expect(res.status).toBe(400)
  expect(((await res.json()) as { error: string }).error).toContain('not a valid Solana address')
})
