import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Report } from '@agon/core'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  MAX_TAGLINE_CHARS,
  TAGLINE,
  cardAmount,
  cardCaption,
  escape,
  shareCard,
} from './card.js'
import { cardRoute } from './routes.js'

const fixture = (): Report => {
  const { synthetic: _s, ...rest } = JSON.parse(
    readFileSync(new URL('../../../fixtures/contracts/report.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>
  return Report.parse(rest)
}

/** base58, 32 to 44 characters: what a Solana address looks like to anyone reading the card. */
const ADDRESS = /[1-9A-HJ-NP-Za-km-z]{32,44}/

test('the card carries no wallet address at all, not even the one it was made from', () => {
  // The acceptance says 0 third-party addresses. This goes further on purpose: a card is shared
  // with strangers, and "it is only your own address" is how a trader gets their entire history
  // followed by everyone who sees the image.
  const report = fixture()
  const svg = shareCard(report)
  expect(svg).not.toContain(report.wallet)
  const leaked = ADDRESS.exec(svg)
  expect(leaked?.[0], `something address-shaped is on the card: ${leaked?.[0]}`).toBeUndefined()
})

test('the card carries no name and no third-party P&L, only what it cost the sharer', () => {
  const svg = shareCard(fixture())
  expect(svg).toContain('I broke my own rules')
  // First person only. A card that says what somebody else lost is a different product.
  expect(svg).not.toMatch(/\bthey\b|\bhis\b|\bher\b|\btheir\b/i)
})

test('the cost is shown as a magnitude with its unit, never a bare number', () => {
  expect(cardAmount(fixture())).toMatch(/^[\d.]+ SOL$/)
  expect(cardAmount(fixture())).not.toContain('-')
})

test('0 exceptions is a card too, and says so rather than showing a blank', () => {
  const clean = Report.parse({ ...fixture(), exceptions: { count: 0, cost: '0' } })
  expect(cardCaption(clean)).toBe('I did not break my own rules')
  expect(shareCard(clean)).toContain('did not break my own rules')
  expect(shareCard(clean)).toContain('0 SOL')
})

test('one exception is singular, because "1 times" is how a demo dies', () => {
  const one = Report.parse({ ...fixture(), exceptions: { count: 1, cost: '-1000000000' } })
  expect(cardCaption(one)).toBe('1 time I broke my own rules')
})

test('the svg is well formed and the declared size matches the viewBox', () => {
  const svg = shareCard(fixture())
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  expect(svg).toContain(`viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"`)
  expect(svg.split('<').length, 'unbalanced tags').toBe(svg.split('>').length)
})

test('generated in well under the 2 second budget', () => {
  const report = fixture()
  const started = performance.now()
  for (let i = 0; i < 100; i++) shareCard(report)
  const each = (performance.now() - started) / 100
  expect(each, `${each.toFixed(3)} ms per card`).toBeLessThan(2000)
  // The real number, so a future change that makes this slow is visible rather than merely legal.
  expect(each, `${each.toFixed(3)} ms per card, budget is 2000`).toBeLessThan(5)
})

test('the route serves an image that a browser will not run as script', async () => {
  // Same-origin SVG is a script execution context. Content type alone is not the control.
  const res = await cardRoute(
    new Request('https://agon.test/api/card?wallet=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'),
  )
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('image/svg+xml')
  expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(res.headers.get('content-security-policy')).toContain('sandbox')
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
})

test('a bad address is a 400, not a broken image', async () => {
  const res = await cardRoute(new Request('https://agon.test/api/card?wallet=nope'))
  expect(res.status).toBe(400)
})

test('the escape closes every way out of an svg text node', () => {
  // Tested directly, and that is the point. Nothing user controlled reaches the card today: the
  // caption comes from a count and the figure from SignedBaseUnits, which the contract validates as
  // digits. Planting a script in some other report field and asserting the svg is clean passes
  // whether or not this function exists, which is a test that proves nothing. This one fails the
  // moment the escaping goes.
  expect(escape('</text><script>alert(1)</script>')).toBe(
    '&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
  )
  expect(escape('a & b')).toBe('a &amp; b')
  expect(escape(`" onload="x`)).toBe('&quot; onload=&quot;x')
  expect(escape("' onload='x")).toBe('&apos; onload=&apos;x')
  expect(escape('nothing to do here')).toBe('nothing to do here')
})

test('a report whose other fields are hostile still produces a clean card', () => {
  // Because those fields do not reach the card at all, which is worth pinning: if someone later
  // renders ruleVersion or the wallet, this fails and they have to think about it.
  const nasty = Report.parse({
    ...fixture(),
    exceptions: { count: 2, cost: '-3100000000' },
    ruleVersion: '</text><script>alert(1)</script><text>',
  })
  const svg = shareCard(nasty)
  expect(svg).not.toContain('<script>')
  expect(svg).not.toContain(nasty.ruleVersion)
  expect(svg.split('<').length).toBe(svg.split('>').length)
})

test('the tagline fits the card, because svg clips instead of wrapping', () => {
  // Caught by looking at the rendered card, not by a test: the first tagline was 58 characters and
  // ran off the right edge, and the endpoint still returned 200 with a perfectly valid svg.
  expect(TAGLINE.length).toBeLessThanOrEqual(MAX_TAGLINE_CHARS)
  expect(shareCard(fixture())).toContain(TAGLINE)
})
