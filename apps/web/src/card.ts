// The shareable card: what breaking your own rules cost, as one image.
//
// SVG and not PNG, deliberately, and the tradeoff is written down in the PR: SVG needs no
// dependency, renders exactly, and generates in under a millisecond, but X and most social
// previews only raster formats. The endpoint is shaped so a `format=png` can be added behind it
// without changing anything that calls it.
//
// Two rules the acceptance sets, and they are the reason this file is tested rather than eyeballed:
// 0 third-party wallet addresses and 0 named-person P&L. So the card carries no address at all,
// not even the wallet it was made from. A card is shared with strangers, and "it is only your own
// address" is how a trader gets their whole history followed by anyone who sees the image.

import type { Report } from '@agon/core'
import { QUOTE_SYMBOL, amount } from './present.js'

/** The line along the bottom. Length matters: there is no text measuring pass in an SVG, so a
 *  tagline that is too long is simply clipped at the card edge and still renders 200. */
export const TAGLINE = 'Agon caps your agent at your own habits'

/** The widest a line may be before it clips, in characters, at the sizes used below. system-ui at
 *  34px averages a little over half its size per character, so this is deliberately pessimistic. */
export const MAX_TAGLINE_CHARS = 48

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/**
 * Everything interpolated below goes through this. An unescaped `<` turns an image into markup, and
 * this SVG is served from our own origin, so that is an XSS and not a broken picture.
 *
 * Nothing that reaches the card is user controlled today: the caption is built from a count and the
 * figure from `SignedBaseUnits`, which the frozen contract validates as digits. Exported so it is
 * tested directly rather than through a report that cannot currently carry a hostile string, which
 * would be a test that passes whether or not the escaping exists.
 */
export const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** The line under the number. Says what happened, never who it happened to. */
export function cardCaption(report: Report): string {
  const { count } = report.exceptions
  if (count === 0) return 'I did not break my own rules'
  return `${count} time${count === 1 ? '' : 's'} I broke my own rules`
}

/** The number, always positive and always labelled, because a bare "3.1" is not a cost. */
export function cardAmount(report: Report): string {
  const cost = report.exceptions.cost
  return `${amount(cost.startsWith('-') ? cost.slice(1) : cost)} ${QUOTE_SYMBOL}`
}

export function cardHeadline(report: Report): string {
  if (report.exceptions.count === 0) return 'It cost me nothing'
  return report.exceptions.cost.startsWith('-') ? 'It cost me' : 'It made me'
}

/**
 * The card. Pure string building: no fonts to load, no network, no measuring pass, so the 2 second
 * budget is not a thing that has to be watched.
 */
export function shareCard(report: Report): string {
  const headline = escape(cardHeadline(report))
  const figure = escape(cardAmount(report))
  const caption = escape(cardCaption(report))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${caption}, ${headline} ${figure}">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#131316"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="10" fill="#7fd1b9"/>
  <text x="80" y="150" font-family="system-ui, sans-serif" font-size="42" fill="#9a9aa4">${caption}</text>
  <text x="80" y="230" font-family="system-ui, sans-serif" font-size="42" fill="#9a9aa4">${headline}</text>
  <text x="80" y="400" font-family="system-ui, sans-serif" font-size="150" font-weight="700" fill="#ecece8">${figure}</text>
  <text x="80" y="520" font-family="system-ui, sans-serif" font-size="34" fill="#7fd1b9">${escape(TAGLINE)}</text>
  <text x="80" y="575" font-family="system-ui, sans-serif" font-size="28" fill="#5c5c68">No wallet address is on this card</text>
</svg>
`
}
