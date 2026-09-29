// Next.js app and API routes. The 3 legs T-E03 wires end to end live in legs.ts and their HTTP
// shape in routes.ts, both under src so `tsc -b` builds them and the release job proves they
// compile on the stripped tree. The files under app/ are one line each.

export { FIXTURE_NOTE, NotArmable, armRule, armedRuleExample, checkTrade, report } from './legs.js'
export { armRoute, cardRoute, checkTradeRoute, reportRoute, ruleFeedbackRoute } from './routes.js'
export * from './card.js'
export * from './present.js'
export { formatUnits } from './sol.js'
