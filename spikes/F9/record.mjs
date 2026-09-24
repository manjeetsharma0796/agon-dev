// Records the pinned snapshot. Run once, against a surfpool forked from a real datasource:
//
//   surfpool start --rpc-url "https://mainnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" --no-tui
//   node spikes/F9/record.mjs
//
// The export is never parsed as JSON here, and that is the whole point of this file.
// `surfnet_exportSnapshot` returns rentEpoch as u64::MAX, 18446744073709551615, which is larger
// than Number.MAX_SAFE_INTEGER. JSON.parse turns it into a float and JSON.stringify writes it back
// as 18446744073709552000, a different integer that still looks like a plausible u64. Surfpool
// refuses that file, which is the lucky outcome: a more forgiving importer would have loaded a
// snapshot that quietly disagreed with the chain it was taken from. So the bytes move as text.
//
// It also writes snapshot.meta.json, because the importable form is a bare account map with no
// room for the slot it was taken at, and a pinned state that cannot say what it is pinned to is
// not evidence.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const url = `http://127.0.0.1:${process.env['SURFPOOL_PORT'] ?? '8899'}`

const raw = async (method, params = []) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return await res.text()
}

/** The substring of `text` that is the object value of `"<key>":`, braces matched. No number here
 *  ever becomes a JS number, so nothing can lose precision on the way through. */
const objectAt = (text, key) => {
  const at = text.indexOf(`"${key}":`)
  if (at === -1) throw new Error(`the export has no "${key}" field`)
  const start = text.indexOf('{', at)
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) escaped = false
    else if (ch === '\\') escaped = true
    else if (ch === '"') inString = !inString
    else if (!inString && ch === '{') depth++
    else if (!inString && ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`"${key}" is not a closed object`)
}

const labels = JSON.parse(readFileSync(`${here}../F3/mints.json`, 'utf8'))
const mints = ['blueChip', 'dangerousAuthority', 'dangerousToken2022'].flatMap((g) =>
  labels[g].map((m) => m.mint),
)

// Touch every account the spike will read, so the lazy fork materialises them before the export.
const touched = JSON.parse(await raw('getMultipleAccounts', [mints, { encoding: 'jsonParsed' }]))
const found = (touched.result?.value ?? []).filter(Boolean).length
if (found !== mints.length) {
  throw new Error(
    `only ${found} of ${mints.length} mints materialised; the fork is not serving them`,
  )
}

const text = await raw('surfnet_exportSnapshot', [])
const accounts = objectAt(text, 'value')
// Slot read off the text for the same reason, though it is small enough to be safe either way.
const slot = /"slot"\s*:\s*(\d+)/.exec(text)?.[1]
if (slot === undefined) throw new Error('the export carries no context slot, so it is not pinned')

writeFileSync(`${here}snapshot.json`, `${accounts}\n`)
writeFileSync(
  `${here}snapshot.meta.json`,
  `${JSON.stringify(
    {
      slot: Number(slot),
      accounts: (accounts.match(/"[1-9A-HJ-NP-Za-km-z]{32,44}":/g) ?? []).length,
      mintsTouched: mints.length,
      recorded: new Date().toISOString().slice(0, 10),
      note: 'snapshot.json is the bare account map surfpool --snapshot takes. It is copied as text, never re-serialised, because a JS round trip changes rentEpoch.',
    },
    null,
    2,
  )}\n`,
)
console.log(`recorded ${mints.length} mints into a snapshot at slot ${slot}`)
