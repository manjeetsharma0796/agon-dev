import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { SWIG_PROGRAM_ID } from '@agon/chain'
import { expect, test } from 'vitest'

// The kit is run the way an agent runs it, as its own node process with its own HOME, and checked
// against @solana/web3.js: a key or a signature only this file agrees with is worth nothing.

const KIT = fileURLToPath(new URL('../kit/agon-kit.mjs', import.meta.url))
// The id the server builds with, so the kit's own pinned copy cannot drift from it unnoticed.
const SWIG = new PublicKey(SWIG_PROGRAM_ID)

const kit = (home: string, ...args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [KIT, ...args], { env: { ...process.env, HOME: home } }, (e, o, r) =>
      resolve({ code: e ? Number(e.code) : 0, stdout: o, stderr: r }),
    )
  })

const newHome = () => mkdtempSync(join(tmpdir(), 'agon-kit-'))

/** A fork that answers the 3 calls the kit makes, and keeps what it was sent. */
const fakeFork = async (surfnet = true) => {
  const sent: string[] = []
  const statusAsked: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      const { method, params } = JSON.parse(body) as { method: string; params: unknown[] }
      let result: unknown = { 'solana-core': '2.3.0' }
      if (method === 'getVersion' && surfnet) result = { 'surfnet-version': '1.6.0' }
      if (method === 'sendTransaction') {
        sent.push(params[0] as string)
        result = 'ignored'
      }
      if (method === 'getSignatureStatuses') {
        statusAsked.push((params[0] as string[])[0] as string)
        result = { value: [{ confirmationStatus: 'confirmed', err: null }] }
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, sent, statusAsked, close: () => server.close() }
}

/** The shape prepare_swap returns: the agent pays and signs alone, compute budget then Swig. */
const swapShaped = (agent: PublicKey, ...extra: TransactionInstruction[]) =>
  new Transaction({ feePayer: agent, recentBlockhash: Keypair.generate().publicKey.toBase58() })
    .add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      new TransactionInstruction({
        programId: SWIG,
        keys: [
          { pubkey: agent, isSigner: true, isWritable: true },
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        ],
        // SignV2, as in the transaction prepare_swap built on the fork on 2026-10-01.
        data: Buffer.from([11, 0, 70, 0]),
      }),
      ...extra,
    )
    .serialize({ requireAllSignatures: false })
    .toString('base64')

test('key makes a web3.js keypair once, prints only its public key, and keeps it chmod 600', async () => {
  const home = newHome()
  const first = await kit(home, 'key')
  expect(first.code, first.stderr).toBe(0)
  const file = join(home, '.agon', 'agent-key.json')
  expect(statSync(file).mode & 0o777).toBe(0o600)
  // fromSecretKey checks the public half against the seed, so a mismatched file throws here.
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))))
  expect(first.stdout).toBe(`${keypair.publicKey.toBase58()}\n`)
  expect(await kit(home, 'key')).toEqual(first)
})

test('send signs a prepare_swap transaction web3.js verifies, sends it to the fork, confirms it', async () => {
  const home = newHome()
  const agent = new PublicKey((await kit(home, 'key')).stdout.trim())
  const fork = await fakeFork()
  const out = await kit(home, 'send', swapShaped(agent), '--rpc', fork.url)
  fork.close()
  expect(out.code, out.stderr).toBe(0)
  expect(fork.sent).toHaveLength(1)
  const sent = Transaction.from(Buffer.from(fork.sent[0] as string, 'base64'))
  expect(sent.verifySignatures()).toBe(true)
  expect(sent.feePayer?.equals(agent)).toBe(true)
  // It confirms the id it prints, and that id is the signature it sent.
  expect(fork.statusAsked[0]).toBe(out.stdout.trim())
  expect(out.stdout.trim()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/)
})

test('send refuses, with the cause, anything but a swap it alone signs and pays for', async () => {
  const home = newHome()
  const agent = new PublicKey((await kit(home, 'key')).stdout.trim())
  const fork = await fakeFork()
  const stranger = Keypair.generate().publicKey
  const cases: [string, string][] = [
    // All zero bytes: base58 must keep leading zeros as 1s, or this names a different key.
    [swapShaped(PublicKey.default), `fee payer is ${PublicKey.default.toBase58()}, not your key`],
    [
      swapShaped(
        agent,
        SystemProgram.transfer({ fromPubkey: agent, toPubkey: stranger, lamports: 1 }),
      ),
      'not only Swig',
    ],
    // Swig's CreateV1: signed by the agent alone, it could set up a wallet that spends its SOL.
    [
      swapShaped(
        agent,
        new TransactionInstruction({ programId: SWIG, keys: [], data: Buffer.from([0, 0]) }),
      ),
      'not only Swig',
    ],
    // A price turns the compute limit into a fee paid from the agent's SOL.
    [
      swapShaped(agent, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000 })),
      'not only Swig',
    ],
    [
      swapShaped(
        agent,
        new TransactionInstruction({
          programId: SWIG,
          keys: [{ pubkey: stranger, isSigner: true, isWritable: false }],
        }),
      ),
      'needs 2 signers',
    ],
    ['not base64!', 'Pass the base64 transaction'],
  ]
  for (const [tx, cause] of cases) {
    const out = await kit(home, 'send', tx, '--rpc', fork.url)
    expect(out.code, cause).toBe(1)
    expect(out.stderr).toContain(cause)
  }
  expect(await kit(newHome(), 'send', swapShaped(agent), '--rpc', fork.url)).toMatchObject({
    code: 1,
    stderr: expect.stringContaining('No key yet'),
  })
  fork.close()
  const notFork = await fakeFork(false)
  const out = await kit(home, 'send', swapShaped(agent), '--rpc', notFork.url)
  notFork.close()
  expect(out.code).toBe(1)
  expect(out.stderr).toContain('is not the practice fork')
  expect(fork.sent.length + notFork.sent.length, 'a refused transaction was sent').toBe(0)
})

test('the built server serves the kit and names its own address for it in the instructions', async () => {
  // Spawned like serve.test.ts: serve.ts listens on import. Port fixed for the same reason.
  const port = 8798
  const script = `
    process.env.PORT = '${port}'
    process.env.HOST = '127.0.0.1'
    await import('./dist/serve.js')
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:${port}/health'); break } catch { await new Promise(r => setTimeout(r, 100)) }
    }
    const kit = await fetch('http://127.0.0.1:${port}/kit.mjs')
    const head = await fetch('http://127.0.0.1:${port}/kit.mjs', { method: 'HEAD' })
    // A client that reached us by a public name: fetch cannot set Host, node:http can.
    const { request } = await import('node:http')
    const remote = await new Promise((resolve) => {
      const r = request({ host: '127.0.0.1', port: ${port}, path: '/mcp', method: 'POST', headers: {
        host: 'agon.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } },
        (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)) })
      r.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kit-test', version: '0' } } }))
    })
    const init = await fetch('http://127.0.0.1:${port}/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kit-test', version: '0' } } }),
    })
    console.log(JSON.stringify({ type: kit.headers.get('content-type'), kit: await kit.text(), init: await init.text(), head: head.status, remote }))
    process.exit(0)
  `
  const out = await new Promise<string>((resolve, reject) =>
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script],
      { cwd: fileURLToPath(new URL('..', import.meta.url)) },
      (e, stdout) => (e ? reject(e) : resolve(stdout)),
    ),
  )
  const seen = JSON.parse(out.trim()) as {
    type: string
    kit: string
    init: string
    head: number
    remote: string
  }
  expect(seen.head).toBe(200)
  // Loopback gets plain http; any other host is told https, since the kit handles a key.
  expect(seen.remote).toContain('https://agon.example.com/kit.mjs')
  expect(seen.type).toMatch(/^text\/javascript/)
  expect(seen.kit).toBe(readFileSync(KIT, 'utf8'))
  expect(seen.init).toContain(
    `curl -fsS --create-dirs -o ~/.agon/agon-kit.mjs http://127.0.0.1:${port}/kit.mjs && node`,
  )
})
