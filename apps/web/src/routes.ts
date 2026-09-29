// The HTTP shape of the 3 legs. It lives here, under src, because src is what `tsc -b` builds and
// what the release job proves compiles on the stripped tree. The files under app/ are one line
// each that re-export these, so a Next route cannot drift from the thing it serves.

import { appendFileSync } from 'node:fs'
import { Address } from '@agon/core'
import { FIXTURE_NOTE, NotArmable, armRule, checkTrade, report } from './legs.js'
import { RULE_ANSWERS, type RuleAnswer } from './present.js'
import { shareCard } from './card.js'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Every failure names the cause and what to do next. No blank fields, no "something went wrong". */
/**
 * Blames the caller only when the caller is at fault.
 *
 * This used to blame them for everything it caught. A missing fixture came back as "That is not a
 * valid Solana address." with a 400, on a perfectly valid address, and the real cause was only in
 * `detail` where nothing reads it. A beta user would have gone and checked their wallet. Found by
 * deleting `fixtures/contracts/` and asking for a report.
 *
 * A zod failure is the caller's input and stays a 400. Anything else is ours and is a 500, because
 * a server that cannot read its own data has not been sent a bad request.
 */
const badRequest = (error: unknown, what: string): Response => {
  const message = error instanceof Error ? error.message : String(error)
  // Two things are the caller's fault and they arrive differently. A schema failure is a ZodError,
  // matched by name rather than instanceof because this package does not depend on zod directly
  // and a second copy of zod across a package boundary makes instanceof false while the name stays
  // right. A body that is not JSON never reaches a schema at all, so it is thrown as InputError.
  // Everything else is ours. Splitting only on zod sent "the request body is not JSON" to a 500,
  // which the existing test caught.
  const fromInput =
    error instanceof InputError || (error instanceof Error && error.name === 'ZodError')
  return json(
    {
      error: fromInput
        ? `That is not a valid ${what}.`
        : `This request could not be served, and it is not because of what you sent.`,
      detail: message,
    },
    fromInput ? 400 : 500,
  )
}

/** Thrown when the caller sent something unparseable, which is a 400 and not a server fault. */
class InputError extends Error {}

const body = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    throw new InputError('The request body is not JSON.')
  }
}

export const reportRoute = async (request: Request): Promise<Response> => {
  const wallet = new URL(request.url).searchParams.get('wallet')
  try {
    // The wallet echoed back is the one that was asked about, which is intended. The note is what
    // stops that reading as identity: without it the payload hands a caller a wallet field and a
    // metrics block with nothing saying the numbers belong to a different wallet entirely.
    return json({ ...report({ wallet }), note: FIXTURE_NOTE })
  } catch (error) {
    return badRequest(error, 'Solana address')
  }
}

export const checkTradeRoute = async (request: Request): Promise<Response> => {
  try {
    return json({ ...checkTrade(await body(request)), note: FIXTURE_NOTE })
  } catch (error) {
    return badRequest(error, 'check_trade input')
  }
}

export const armRoute = async (request: Request): Promise<Response> => {
  let spec: unknown
  try {
    spec = await body(request)
  } catch (error) {
    return badRequest(error, 'rule spec')
  }
  try {
    const env = { publicUrl: process.env['AGON_PUBLIC_URL'], network: process.env['AGON_NETWORK'] }
    return json(armRule(spec, env), 200)
  } catch (error) {
    // 503, not 400 and not 500. The request was fine and nothing is broken; the capability is off,
    // and anything that can move funds fails closed until it is on.
    if (error instanceof NotArmable) return json({ error: error.message, code: error.code }, 503)
    return badRequest(error, 'rule spec')
  }
  /* c8 ignore next */
  return json({ error: 'unreachable: arming returned instead of refusing' }, 500)
}

/**
 * "Is this rule right about you?", stored.
 *
 * There is no database yet, and an answer that is accepted and dropped is worse than one
 * that is refused: CP3's gate is a percentage of these answers, so a silent loss makes the gate
 * unmeasurable and nobody finds out until the checkpoint. So the destination is explicit.
 * `AGON_FEEDBACK_FILE` is opted into, rather than defaulting to somewhere writable but ephemeral,
 * because a default that works on a laptop and evaporates on a serverless host is the same silent
 * loss with extra steps.
 */
export const ruleFeedbackRoute = async (request: Request): Promise<Response> => {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'The request body is not JSON.', detail: 'Send {wallet, answer}.' }, 400)
  }

  const { wallet, answer } = (payload ?? {}) as { wallet?: unknown; answer?: unknown }
  const checkedWallet = Address.safeParse(wallet)
  if (!checkedWallet.success) {
    return json(
      { error: 'That is not a valid Solana address.', detail: checkedWallet.error.message },
      400,
    )
  }
  if (!RULE_ANSWERS.includes(answer as RuleAnswer)) {
    return json(
      {
        error: `The answer must be one of ${RULE_ANSWERS.join(', ')}.`,
        detail: `Received ${JSON.stringify(answer)}.`,
      },
      400,
    )
  }

  const file = process.env['AGON_FEEDBACK_FILE']
  if (file === undefined || file === '') {
    return json(
      {
        error: 'Your answer was not recorded.',
        detail:
          'There is nowhere to store it yet. Set AGON_FEEDBACK_FILE, or wait for the database. ' +
          'Saying this is better than accepting the answer and losing it, because the CP3 gate is ' +
          'a percentage of these answers.',
        code: 'no-feedback-store',
      },
      503,
    )
  }

  try {
    appendFileSync(
      file,
      `${JSON.stringify({ wallet: checkedWallet.data, answer, at: new Date().toISOString() })}\n`,
    )
  } catch (error) {
    return json(
      {
        error: 'Your answer was not recorded.',
        detail: `Writing to ${file} failed (${error instanceof Error ? error.name : 'unknown'}).`,
        code: 'feedback-store-failed',
      },
      503,
    )
  }
  return json({ recorded: true, answer })
}

/**
 * The share card, as an image.
 *
 * Served with `default-src 'none'` and nosniff. An SVG on the same origin is a script execution
 * context, so an unescaped character in it is an XSS on our own domain rather than a broken
 * picture. Everything interpolated is escaped in card.ts and the header is the second lock.
 */
export const cardRoute = async (request: Request): Promise<Response> => {
  const wallet = new URL(request.url).searchParams.get('wallet')
  let svg: string
  try {
    svg = shareCard(report({ wallet }))
  } catch (error) {
    return badRequest(error, 'Solana address')
  }
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
      // A card is about a wallet, so it is cached by URL and not shared between wallets.
      'cache-control': 'public, max-age=300',
    },
  })
}
