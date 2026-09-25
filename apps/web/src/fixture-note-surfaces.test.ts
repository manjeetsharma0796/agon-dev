// T-E13. Every surface that serves a fixture says so.
//
// T-C07 put the marker on the 4 MCP tools and the report page renders it in a role="note" panel.
// These 3 surfaces were missed, and each one hands a number to a caller with nothing saying the
// number is an example.

import { expect, test } from 'vitest'
import { FIXTURE_NOTE } from './fixture-note.js'
import { shareCard } from './card.js'
import { report } from './legs.js'
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
