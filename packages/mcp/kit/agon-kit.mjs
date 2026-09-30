#!/usr/bin/env node
// agon-kit: your agent key and your trade signature on the Agon practice fork. 0 dependencies,
// Node 18 or later. Served by the agon MCP server at /kit.mjs, so no agent writes key code.
//
//   node agon-kit.mjs key                        make your key once (or reuse it), print its public key
//   node agon-kit.mjs send <base64> [--rpc URL]  sign a prepare_swap transaction, send it, confirm it
//
// The key is ~/.agon/agent-key.json, chmod 600, the 64-byte array Solana tools read. Its secret is
// never printed. `send` signs only a transaction you alone sign and pay for, that calls only the
// compute unit limit and Swig's sign, and it sends only to a Surfpool fork (default http://127.0.0.1:8899),
// never to mainnet.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DIR = join(homedir(), '.agon')
const KEY_FILE = join(DIR, 'agent-key.json')
const FORK_RPC = 'http://127.0.0.1:8899'
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'
const SWIG = 'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB'
/** SetComputeUnitLimit, the only compute budget call prepare_swap makes. A price would be a fee. */
const SET_COMPUTE_UNIT_LIMIT = 2
/** Swig's SignV2 (u16 11), so the role's checks apply. Any other Swig call could spend your SOL. */
const SWIG_SIGN_V2 = 11
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const refuse = (message) => {
  throw new Error(message)
}

const base58 = (bytes) => {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let out = ''
  for (; n > 0n; n /= 58n) out = ALPHABET[Number(n % 58n)] + out
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}

function loadKey() {
  if (!existsSync(KEY_FILE)) return null
  let bytes
  try {
    bytes = JSON.parse(readFileSync(KEY_FILE, 'utf8'))
  } catch {
    bytes = null
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => b === (b & 255))) {
    refuse(
      `${KEY_FILE} is not a 64-byte key array, so nothing was signed. Move it away and run key.`,
    )
  }
  const x = Buffer.from(bytes.slice(32)).toString('base64url')
  const privateKey = createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: Buffer.from(bytes.slice(0, 32)).toString('base64url'),
      x,
    },
    format: 'jwk',
  })
  // Node derives the public key from the seed and ignores a stored one that disagrees.
  if (createPublicKey(privateKey).export({ format: 'jwk' }).x !== x) {
    refuse(`${KEY_FILE} holds a public key that does not match its secret, so nothing was signed.`)
  }
  return { privateKey, publicKey: base58(bytes.slice(32)) }
}

function key() {
  const existing = loadKey()
  if (existing) return existing
  mkdirSync(DIR, { recursive: true })
  chmodSync(DIR, 0o700)
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })
  const bytes = [...Buffer.from(jwk.d, 'base64url'), ...Buffer.from(jwk.x, 'base64url')]
  try {
    writeFileSync(KEY_FILE, JSON.stringify(bytes), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    // Another run made it first: use that one.
    if (error.code !== 'EEXIST') throw error
  }
  return loadKey()
}

function shortvec(bytes, at) {
  let value = 0
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i]
    if (b === undefined) break
    value |= (b & 0x7f) << (7 * i)
    if ((b & 0x80) === 0) return [value, at + i + 1]
  }
  return refuse('The transaction ends mid-length, so it was not signed. Call prepare_swap again.')
}

// A legacy transaction: signatures, then the message the signature covers.
function parse(tx) {
  const [signatures, sigAt] = shortvec(tx, 0)
  const message = tx.subarray(sigAt + 64 * signatures)
  if (message[0] & 0x80) {
    refuse('The transaction is versioned, not the legacy one prepare_swap builds, so not signed.')
  }
  let [count, at] = shortvec(message, 3)
  const keys = []
  for (let i = 0; i < count; i++, at += 32) keys.push(base58(message.subarray(at, at + 32)))
  ;[count, at] = shortvec(message, at + 32)
  const calls = []
  for (let i = 0, n; i < count; i++) {
    const program = keys[message[at]]
    ;[n, at] = shortvec(message, at + 1)
    ;[n, at] = shortvec(message, at + n)
    calls.push({ program, data: message.subarray(at, at + n) })
    at += n
  }
  if (message.length < 4 || at !== message.length) {
    refuse('The transaction does not parse as 1 whole message, so it was not signed.')
  }
  return { signatures, sigAt, message, signers: message[0], feePayer: keys[0], calls }
}

async function rpc(url, method, params) {
  let body
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    body = await res.json()
  } catch (error) {
    refuse(`Could not reach ${url} (${error.cause?.code ?? error.message}). Is the fork up?`)
  }
  if (body?.error) {
    const err = body.error.data?.err ? ` ${JSON.stringify(body.error.data.err)}` : ''
    refuse(`${method} on ${url} failed: ${body.error.message}${err}`)
  }
  return body?.result
}

async function send(base64, url) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64 ?? '')) {
    refuse(
      'Pass the base64 transaction prepare_swap returned: node agon-kit.mjs send <transaction>',
    )
  }
  const mine = loadKey() ?? refuse('No key yet, so nothing was signed. Run: node agon-kit.mjs key')
  const tx = Buffer.from(base64, 'base64')
  const t = parse(tx)
  if (t.signatures !== 1 || t.signers !== 1) {
    refuse(
      `The transaction needs ${t.signers} signers, and this kit signs only one it signs alone. ` +
        'Sign only what prepare_swap returns.',
    )
  }
  if (t.feePayer !== mine.publicKey) {
    refuse(
      `The fee payer is ${t.feePayer}, not your key ${mine.publicKey}, so it was not signed. ` +
        `Call prepare_swap again with agent ${mine.publicKey}.`,
    )
  }
  const other = t.calls.find(
    ({ program, data }) =>
      !(program === SWIG && data[0] === SWIG_SIGN_V2 && data[1] === 0) &&
      !(program === COMPUTE_BUDGET && data[0] === SET_COMPUTE_UNIT_LIMIT),
  )
  if (other !== undefined) {
    refuse(
      `The transaction calls ${other.program} (instruction ${other.data[0]}), not only Swig's ` +
        'sign and a compute unit limit, so it was not signed. Sign only what prepare_swap returns.',
    )
  }
  const version = await rpc(url, 'getVersion', [])
  if (typeof version?.['surfnet-version'] !== 'string') {
    refuse(
      `${url} is not the practice fork (no surfnet-version), so nothing was sent. Leave out ` +
        `--rpc to send to ${FORK_RPC}.`,
    )
  }
  const signature = sign(null, t.message, mine.privateKey)
  signature.copy(tx, t.sigAt)
  const id = base58(signature)
  await rpc(url, 'sendTransaction', [tx.toString('base64'), { encoding: 'base64' }])
  for (let i = 0; i < 60; i++) {
    const [status] = (await rpc(url, 'getSignatureStatuses', [[id]]))?.value ?? []
    if (status?.err) {
      refuse(`${id} landed and failed: ${JSON.stringify(status.err)}. Call prepare_swap again.`)
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return id
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return refuse(`${id} was sent but not confirmed within 30 s. Check it before sending again.`)
}

const [command, arg, flag, value] = process.argv.slice(2)
try {
  if (command === 'key') console.log(key().publicKey)
  else if (command === 'send') console.log(await send(arg, flag === '--rpc' ? value : FORK_RPC))
  else refuse('Usage: node agon-kit.mjs key | node agon-kit.mjs send <base64> [--rpc URL]')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
