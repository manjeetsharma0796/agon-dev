import { expect, test } from 'vitest'
import { CheckTradeOutput, Report } from '@agon/core'
import { armRoute, checkTradeRoute, reportRoute } from './routes.js'

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

test('leg 3 over HTTP: arming refuses with 503, and says what turns it on', async () => {
  // 503 and not 400: the request is fine and nothing is broken, the capability is off. Anything
  // that can move funds fails closed.
  const res = await armRoute(
    post('https://agon.test/api/arm', {
      mints: ['So11111111111111111111111111111111111111112'],
      cap: {
        mint: 'So11111111111111111111111111111111111111112',
        amount: '25000000000',
        windowSeconds: 86400,
      },
      triggerType: 'stop',
      expiresAt: null,
    }),
  )
  expect(res.status).toBe(503)
  const body = await jsonOf(res)
  expect(body.code).toBe('not-armable')
  expect(body.error).toContain('F5 and F6')
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
