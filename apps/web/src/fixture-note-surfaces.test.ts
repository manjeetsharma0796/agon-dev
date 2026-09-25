// T-E13. Every surface that serves a fixture says so.
//
// T-C07 put the marker on the 4 MCP tools and the report page renders it in a role="note" panel.
// These 3 surfaces were missed, and each one hands a number to a caller with nothing saying the
// number is an example.

import { expect, test } from 'vitest'
import { FIXTURE_NOTE } from './fixture-note.js'
import { FOOTER, MAX_TAGLINE_CHARS, shareCard } from './card.js'
import { checkTrade, report } from './legs.js'
import { checkTradeRoute, reportRoute } from './routes.js'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

test('the report route says its numbers are an example, next to the wallet it echoed', async () => {
  // The echo is intended and stays: you paste an address, you see that address. What makes it
  // honest is the label, and the payload had no label at all, so a caller reading `wallet` and
  // `metrics` had nothing telling them the 34 closed trades are not that wallet's.
  const res = await reportRoute(new Request(`https://agon.test/api/report?wallet=${WALLET}`))
  const body = (await res.json()) as Record<string, unknown>
  expect(body.wallet).toBe(WALLET)
  expect(body.note).toBe(FIXTURE_NOTE)
})

test('the check_trade route says its verdict came from a fixture', async () => {
  const res = await checkTradeRoute(
    new Request('https://agon.test/api/check-trade', {
      method: 'POST',
      body: JSON.stringify({
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        side: 'buy',
        size: '3200000000',
        wallet: WALLET,
      }),
    }),
  )
  const body = (await res.json()) as Record<string, unknown>
  expect(body.note).toBe(FIXTURE_NOTE)
})

test('the share card names itself an example, because a card is made to be posted', () => {
  // The card is already right about identity: it carries no address, not even the one it was built
  // from, and says so on its face. What it did not say is that the figure is invented, and a card
  // exists to be shared with strangers who cannot check.
  const svg = shareCard(report({ wallet: WALLET }))
  expect(svg).toMatch(/example/i)
})

test('the check_trade route still answers from the leg, which is what makes its note true', async () => {
  // The guard on the label, not on the label's text. `checkTradeRoute` stamps the fixture note
  // unconditionally, and that is only honest while the route answers from the fixture-backed leg.
  // `packages/mcp/src/mcp.test.ts` records that the intended fix is to point this route at
  // `assessTrade`, which reads the chain. On the day that happens, this test fails and whoever does
  // it has to decide what the note should say, instead of shipping a payload that claims no chain
  // data was read while reading the chain. The MCP layer conditions its own marker on
  // `io.usedFixture()`; the route has no such signal, so this test is the signal.
  const trade = {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    side: 'buy',
    size: '3200000000',
    wallet: WALLET,
  }
  const res = await checkTradeRoute(
    new Request('https://agon.test/api/check-trade', {
      method: 'POST',
      body: JSON.stringify(trade),
    }),
  )
  const { note, ...overHttp } = (await res.json()) as Record<string, unknown>
  expect(note).toBe(FIXTURE_NOTE)
  expect(overHttp).toEqual(checkTrade(trade))
})

test('the card footer is bounded, because it is the longest line on the card', () => {
  // An over-long line clips at the card edge and still renders 200, so nothing tells you. `TAGLINE`
  // is asserted against this bound in `card.test.ts`; the footer was longer than `TAGLINE` and had
  // no bound at all, which made the card's longest line the one nothing checked.
  expect(FOOTER.length).toBeLessThanOrEqual(MAX_TAGLINE_CHARS)
})
