// The HTTP shape of the 3 legs. It lives here, under src, because src is what `tsc -b` builds and
// what the release job proves compiles on the stripped tree. The files under app/ are one line
// each that re-export these, so a Next route cannot drift from the thing it serves.

import { NotArmable, armRule, checkTrade, report } from './legs.js'

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
