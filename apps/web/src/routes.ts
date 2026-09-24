// The HTTP shape of the 3 legs. It lives here, under src, because src is what `tsc -b` builds and
// what the release job proves compiles on the stripped tree. The files under app/ are one line
// each that re-export these, so a Next route cannot drift from the thing it serves.

import { appendFileSync } from 'node:fs'
import { Address } from '@agon/core'
import { NotArmable, armRule, checkTrade, report } from './legs.js'
import { RULE_ANSWERS, type RuleAnswer } from './present.js'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Every failure names the cause and what to do next. No blank fields, no "something went wrong". */
const badRequest = (error: unknown, what: string): Response =>
  json(
    {
      error: `That is not a valid ${what}.`,
      detail: error instanceof Error ? error.message : String(error),
    },
    400,
  )

const body = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    throw new Error('The request body is not JSON.')
  }
}

export const reportRoute = async (request: Request): Promise<Response> => {
  const wallet = new URL(request.url).searchParams.get('wallet')
  try {
    return json(report({ wallet }))
  } catch (error) {
    return badRequest(error, 'Solana address')
  }
}

export const checkTradeRoute = async (request: Request): Promise<Response> => {
  try {
    return json(checkTrade(await body(request)))
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
    armRule(spec)
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
