// Records the 2 programs F5 executes against, because the snapshot exporter will not.
//
//   surfpool start --rpc-url "https://mainnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" --no-tui
//   node spikes/F5/record-programs.mjs
//
// This file exists because of a measurement, not a preference. `surfnet_exportSnapshot` does not
// export programs at all: touching Jupiter and Swig on a live fork leaves the export at 294
// accounts and 278 KB, unchanged, with neither program id in it. The method takes 2 scopes,
// `network` and `preTransaction`, and `network`, which is what F9 uses, emits data accounts only.
//
// So F9's property, commit a snapshot and replay it `--offline` with 0 keys, does not reach F5 on
// its own: the programs F5 exists to execute against would be missing and every case would fail
// for the wrong reason, which is exactly how F5 failed on devnet.
//
// It does reach F5 with this file. The snapshot format carries `executable`, and `--snapshot` can
// be given more than once, so these 4 accounts go in a second file that is stacked on F9's:
//
//   surfpool start --offline --snapshot spikes/F9/snapshot.json --snapshot spikes/F5/programs.json
//
// Verified with HELIUS_API_KEY unset: Jupiter and Swig come back at their real mainnet ids with
// `executable: true` and owner BPFLoaderUpgradeable.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const url = `http://127.0.0.1:${process.env['SURFPOOL_PORT'] ?? '8899'}`

const rpc = async (method, params = []) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await res.json()).result
}

/**
 * The 4 accounts, and it is 4 rather than 2 because a BPF upgradeable program is 2 accounts: the
 * program, which is a 36-byte pointer, and the program data, which is the code. Loading only the
 * pointer gives a program whose body cannot be found, which fails at execution rather than at
 * load, and that is a worse failure than a missing account because it looks like a bug in the
 * transaction.
 */
const IDS = {
  jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  jupiterProgramData: '4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT',
  swig: 'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB',
  swigProgramData: 'Bb6gN8CtkMXf7cfXKnWysmdBg5B8EZfP5kus5TsyH5Es',
}

const entries = []
const sizes = {}
for (const [name, id] of Object.entries(IDS)) {
  const value = (await rpc('getAccountInfo', [id, { encoding: 'base64' }]))?.value
  if (!value) throw new Error(`${name} (${id}) did not materialise; the fork is not serving it`)
  const data = value.data[0]
  sizes[name] = data.length

  // rentEpoch is written as a raw literal and never as a JS number. F9 recorded why: the chain
  // returns u64::MAX, 18446744073709551615, which is past Number.MAX_SAFE_INTEGER, so a JSON round
  // trip writes it back as 18446744073709552000, wrong by 385 and still shaped like a plausible
  // u64. Building the text by hand is the only way the value survives.
  entries.push(
    `${JSON.stringify(id)}:{"lamports":${value.lamports},"owner":${JSON.stringify(value.owner)},` +
      `"executable":${value.executable},"rentEpoch":18446744073709551615,` +
      `"data":${JSON.stringify(data)},"parsedData":null}`,
  )
}

writeFileSync(`${here}programs.json`, `{${entries.join(',')}}\n`)
writeFileSync(
  `${here}programs.meta.json`,
  `${JSON.stringify(
    {
      accounts: Object.keys(IDS).length,
      base64Bytes: sizes,
      recorded: new Date().toISOString().slice(0, 10),
      why: 'surfnet_exportSnapshot scope=network emits data accounts only, so the programs F5 executes against have to be recorded separately and stacked with a second --snapshot.',
    },
    null,
    2,
  )}\n`,
)
console.log(`recorded ${Object.keys(IDS).length} program accounts`)
