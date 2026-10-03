import { createPrivateKey, sign as edSign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import type { JournalRow } from '@agon/core'
import { actionText, handleActions, type ActionChain, type ActionDeps } from './actions.js'
import { callTool, setPaused } from './index.js'
import { liveIo, type ToolIo } from './io.js'
import { createJournal, type JournalStore } from './journal.js'
import { quoteFor, SWAP, SWAP_VAULT } from './test-support.js'

// T-C32. Every action is driven the way a button drives it: 1 plain HTTP call, 0 LLM calls. The
// chain and Jupiter are faked here and check_trade is not: it runs on the recorded wallet, whose
// median buy is 0.0004 SOL (400000 lamports), so a buy at that size passes and 10x it blocks.
// The last test runs the same calls against a real fork, and skips without one.

const WSOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const MEDIAN = 400000n

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const toBase58 = (bytes: Uint8Array): string => {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'))
  let out = ''
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}

/** Ed25519 over raw bytes with a web3.js keypair, through node:crypto. */
const rawSign = (kp: Keypair, bytes: Uint8Array): Buffer =>
  edSign(
    null,
    bytes,
    createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(kp.secretKey.subarray(0, 32)),
      ]),
      format: 'der',
      type: 'pkcs8',
    }),
  )

/** Ed25519 over UTF-8 text, the way Phantom's signMessage signs. */
const signText = (kp: Keypair, text: string): string =>
  toBase58(rawSign(kp, Buffer.from(text, 'utf8')))

const owner = Keypair.generate()
const agent = Keypair.generate()
const stranger = Keypair.generate()
const OWNER = owner.publicKey.toBase58()
const AGENT = agent.publicKey.toBase58()

/** An unsigned legacy transaction paid and signed by the agent, standing in for a built swap. */
const unsignedSwap = (lamports = 1): string =>
  new Transaction({
    feePayer: agent.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
  })
    .add(
      SystemProgram.transfer({
        fromPubkey: agent.publicKey,
        toPubkey: agent.publicKey,
        lamports,
      }),
    )
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64')

/** The vault of OWNER, hiring AGENT on wSOL with `remaining` left, and a record of what ran. */
const vaultIo = (remaining: bigint, over: Partial<ToolIo> = {}) => {
  const calls: string[] = []
  const io: ToolIo = {
    ...liveIo(),
    loadVaultRules: async () => {
      calls.push('vault')
      return {
        owner: OWNER,
        vault: SWAP_VAULT,
        rules: [
          {
            roleId: 1,
            authority: AGENT,
            mint: WSOL,
            amount: 500000000n,
            windowSlots: 150n,
            effectiveRemaining: remaining,
            rollingWorstCase: 1000000000n,
          },
        ],
      }
    },
    loadQuote: async (q) => {
      calls.push('quote')
      return quoteFor(q.amount)
    },
    buildSwap: async () => {
      calls.push('build')
      return {
        vault: SWAP_VAULT,
        transaction: unsignedSwap(),
        lastValidBlockHeight: 1000,
        unitsConsumed: 112000,
        failure: null,
        outputGained: 75900n,
      }
    },
    ...over,
  }
  return { io, calls }
}

/** A chain that answers a send the way `answer` says, counting every send. */
const fakeChain = (answer: 'lands' | 'fails' | 'silent' | 'mainnet') => {
  const sent: string[] = []
  const chain: ActionChain = {
    getVersion: async () =>
      answer === 'mainnet' ? { 'solana-core': '2.3.0' } : { 'surfnet-version': '1.6.0' },
    sendRawTransaction: async (raw) => {
      sent.push(Buffer.from(raw).toString('base64'))
      return 'ignored'
    },
    getSignatureStatuses: async () => ({
      value: [
        answer === 'lands'
          ? { err: null, confirmationStatus: 'confirmed' }
          : answer === 'fails'
            ? { err: { InstructionError: [1, { Custom: 1 }] }, confirmationStatus: 'confirmed' }
            : null,
      ],
    }),
    getBlockHeight: async () => 10,
  }
  return { chain, sent }
}

/** The journal as a list. `down` makes every write fail the way an unreachable Postgres does. */
const memory = (down = false) => {
  const rows: JournalRow[] = []
  const store: JournalStore = {
    insert: async (row) => {
      if (down) throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
      rows.push(row)
    },
    list: async () => ({ rows: [], hidden: 0 }),
  }
  return { rows, store, journal: createJournal(store) }
}

let server: Server
let base = ''
let deps: ActionDeps

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleActions(req, res, deps).then((matched) => {
      if (!matched) res.writeHead(404).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const net = process.env['AGON_NETWORK']
beforeEach(() => {
  process.env['AGON_NETWORK'] = 'fork'
})
afterEach(() => {
  if (net === undefined) delete process.env['AGON_NETWORK']
  else process.env['AGON_NETWORK'] = net
})

/** Wires the deps every route reads, the way serve.ts does. */
const wire = (
  io: ToolIo,
  chain: ActionChain | null,
  m = memory(),
  over: Partial<ActionDeps> = {},
) => {
  deps = {
    io: () => io,
    journal: m.journal,
    mustRecord: async (row) => m.store.insert(row),
    chain,
    publicUrl: 'http://127.0.0.1:3111',
    waitMs: 300,
    watchMs: 600,
    pollMs: 50,
    proposalMs: 300,
    ...over,
  }
  return m
}

type Answer = { status: number; body: Record<string, unknown> }

const post = async (path: string, body: unknown): Promise<Answer> => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** 1 action, signed now by `by` as `actor`, posted to /actions/<action>. */
const act = (
  action: string,
  fields: Record<string, unknown>,
  by: Keypair = owner,
  actor = 'owner-terminal',
  at = new Date().toISOString(),
) => {
  const request = { owner: OWNER, actor, actorKey: by.publicKey.toBase58(), ...fields, at }
  return post(`/actions/${action}`, {
    ...request,
    signature: signText(by, actionText(action, request)),
  })
}

const buy = (amount: bigint, extra: Record<string, unknown> = {}, by = owner, actor?: string) =>
  act(
    'buy',
    {
      mint: USDC,
      amount: String(amount),
      historyWallet: SWAP.historyWallet,
      agent: AGENT,
      ...extra,
    },
    by,
    actor,
  )

/** Signs the cleared transaction with the agent key, as the daemon does, and sends it. */
const signAndSend = (body: Record<string, unknown>, with_: Keypair = agent) => {
  const sign = body['sign'] as { cleared: string; transaction: string }
  const tx = VersionedTransaction.deserialize(Buffer.from(sign.transaction, 'base64'))
  // Written into the fee payer's slot directly, so a wrong key can be tried at all.
  tx.signatures[0] = rawSign(with_, tx.message.serialize())
  return post('/actions/send', {
    cleared: sign.cleared,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- Money first: who signs is decided by the cap the chain holds, to the base unit. ----

test('a buy of exactly the cap left is cleared for the agent key; 1 base unit over goes to the owner and builds nothing', async () => {
  const { io, calls } = vaultIo(MEDIAN)
  const m = wire(io, fakeChain('lands').chain)

  const at = await buy(MEDIAN)
  expect(at.status).toBe(200)
  expect(at.body['outcome']).toBe('sign')
  expect((at.body['verdict'] as { verdict: string }).verdict).toBe('pass')
  expect((at.body['sign'] as { agent: string }).agent).toBe(AGENT)
  expect(calls).toContain('build')

  calls.length = 0
  const over = await buy(MEDIAN + 1n)
  expect(over.body['outcome']).toBe('owner')
  expect(over.body['ownerLink']).toMatch(/^http:\/\/127\.0\.0\.1:3111\/trade#/)
  expect(over.body['ownerLink']).toContain('amount=400001')
  expect(over.body['message']).toMatch(/0\.000400001 wSOL is over the 0\.0004 wSOL/)
  expect(over.body['sign']).toBeUndefined()
  expect(calls, 'an over-cap trade must never be built for the agent key').not.toContain('build')
  // check_trade still ran on the owner's trade: a link is never handed out unjudged.
  expect((over.body['verdict'] as { verdict: string }).verdict).toBe('pass')
  expect(m.rows.map((r) => [r.status, r.actor])).toEqual([
    ['approved', 'owner-terminal'],
    ['approved', 'owner-terminal'],
  ])
})

test('the web never gets the agent key: a web buy inside the cap is still the owner link', async () => {
  const { io, calls } = vaultIo(500000000n)
  wire(io, fakeChain('lands').chain)
  const out = await buy(MEDIAN, {}, owner, 'owner-web')
  expect(out.body['outcome']).toBe('owner')
  expect(calls).not.toContain('build')
})

test('block refuses with its reasons and builds nothing', async () => {
  const { io, calls } = vaultIo(500000000n)
  const m = wire(io, fakeChain('lands').chain)
  const out = await buy(MEDIAN * 10n)
  expect(out.body['outcome']).toBe('refused')
  expect(out.body['message']).toMatch(/check_trade answered block/)
  expect(calls).not.toContain('build')
  expect(m.rows[0]?.status).toBe('refused')
  expect(m.rows[0]?.verdict).toBe('block')
  expect(m.rows[0]?.reasons.length).toBeGreaterThan(0)
})

test('unsure stops; the owner confirming it is a journal row; an agent cannot confirm its own', async () => {
  // A price impact the guard cannot read is unsure, never a pass.
  const { io, calls } = vaultIo(500000000n, { loadQuote: async (q) => quoteFor(q.amount, '1e999') })
  const m = wire(io, fakeChain('lands').chain)

  const stopped = await buy(MEDIAN)
  expect(stopped.body['outcome']).toBe('refused')
  expect(stopped.body['message']).toMatch(/unsure.*confirmUnsure true/)
  expect(calls).not.toContain('build')

  const agentSays = await buy(MEDIAN, { confirmUnsure: true }, agent, 'agent')
  expect(agentSays.body['outcome']).toBe('refused')
  expect(agentSays.body['message']).toMatch(/cannot confirm its own unsure/)
  expect(calls).not.toContain('build')

  const confirmed = await buy(MEDIAN, { confirmUnsure: true })
  expect(confirmed.body['outcome']).toBe('sign')
  const row = m.rows.at(-1)
  expect(row?.status).toBe('approved')
  expect(row?.verdict).toBe('unsure')
  expect(row?.reasons[0]?.rule).toBe('unsure-confirmed')
})

// ---- Sending: once, journaled before the chain sees it, never twice. ----

test('the agent-signed transaction is sent once and journaled sent, then confirmed, with its signature', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('lands')
  const m = wire(io, chain)
  const cleared = await buy(MEDIAN)
  const out = await signAndSend(cleared.body)
  expect(out.status).toBe(200)
  expect(out.body['outcome']).toBe('confirmed')
  expect(sent).toHaveLength(1)
  const signature = out.body['signature']
  expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/)
  expect(m.rows.slice(-2).map((r) => [r.status, r.signature, r.actorKey])).toEqual([
    ['sent', signature, OWNER],
    ['confirmed', signature, OWNER],
  ])

  // The same cleared trade a second time is never sent again.
  const again = await signAndSend(cleared.body)
  expect(again.status).toBe(409)
  expect(sent).toHaveLength(1)
})

test('a transaction other than the one cleared, or signed by another key, is never sent', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('lands')
  wire(io, chain)

  const byStranger = await signAndSend((await buy(MEDIAN)).body, stranger)
  expect(byStranger.body['outcome']).toBe('refused')
  expect(byStranger.body['message']).toMatch(/not signed by the agent key/)

  const cleared = (await buy(MEDIAN)).body
  const other = VersionedTransaction.deserialize(Buffer.from(unsignedSwap(2), 'base64'))
  other.sign([agent])
  const swapped = await post('/actions/send', {
    cleared: (cleared['sign'] as { cleared: string }).cleared,
    transaction: Buffer.from(other.serialize()).toString('base64'),
  })
  expect(swapped.body['message']).toMatch(/not the transaction this action cleared/)
  expect(sent).toHaveLength(0)
})

test('a sent trade with no answer is uncertain, keeps its signature and is never sent again', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('silent')
  const m = wire(io, chain)
  const out = await signAndSend((await buy(MEDIAN)).body)
  expect(out.body['outcome']).toBe('uncertain')
  expect(out.body['message']).toMatch(/never sends it again/)
  await sleep(800)
  expect(sent, 'an uncertain trade was sent a second time').toHaveLength(1)
  expect(m.rows.at(-1)?.status).toBe('uncertain')
  expect(m.rows.at(-1)?.signature).toBe(out.body['signature'])
})

test('a journal that cannot record the send stops the trade before the chain sees it', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('lands')
  wire(io, chain, memory(true))
  const out = await signAndSend((await buy(MEDIAN)).body)
  expect(out.body['outcome']).toBe('refused')
  expect(out.body['message']).toMatch(/could not be journaled.*nothing was sent/)
  expect(sent).toHaveLength(0)
})

// From /code-review: a `sent` row that missed its deadline can still land, which would leave a
// trade that looks in flight forever. A `failed` row with the same signature follows it.
test('a sent row that lands after its deadline is followed by a row saying it never went', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('lands')
  const m = memory()
  wire(io, chain, m, {
    sentRowMs: 50,
    mustRecord: async (row) => {
      await sleep(200)
      await m.store.insert(row)
    },
  })
  const out = await signAndSend((await buy(MEDIAN)).body)
  expect(out.body['outcome']).toBe('refused')
  await sleep(400)
  expect(sent).toHaveLength(0)
  expect(m.rows.slice(-2).map((r) => [r.status, r.reasons[0]?.rule])).toEqual([
    ['sent', 'sent'],
    ['failed', 'not-sent'],
  ])
  expect(m.rows.at(-1)?.signature).toBe(m.rows.at(-2)?.signature)
})

// ---- Proposals, pause, cancel. ----

test('an agent proposal expires unanswered and does nothing; approve runs the same buy; decline is a row', async () => {
  const { io, calls } = vaultIo(500000000n)
  const m = wire(io, fakeChain('lands').chain)

  const lapsed = await buy(MEDIAN, { propose: true }, agent, 'agent')
  expect(lapsed.body['outcome']).toBe('proposed')
  const lapsedId = (lapsed.body['proposal'] as { id: string }).id
  expect(calls).not.toContain('build')
  await sleep(450)
  expect(m.rows.at(-1)?.status).toBe('expired')
  const late = await act('approve', { proposal: lapsedId })
  expect(late.body['outcome']).toBe('expired')
  expect(calls).not.toContain('build')

  const fresh = await buy(MEDIAN, { propose: true }, agent, 'agent')
  const approved = await act('approve', { proposal: (fresh.body['proposal'] as { id: string }).id })
  expect(approved.body['outcome']).toBe('sign')
  expect((approved.body['sign'] as { agent: string }).agent).toBe(AGENT)

  const another = await buy(MEDIAN, { propose: true }, agent, 'agent')
  const anotherId = (another.body['proposal'] as { id: string }).id
  expect((await act('approve', { proposal: anotherId }, agent, 'agent')).status).toBe(403)
  expect((await act('decline', { proposal: anotherId })).body['outcome']).toBe('declined')
  expect(m.rows.at(-1)?.status).toBe('declined')
})

test('pause stops the agent buying, here and in prepare_swap; sells and the owner go on; only the owner resumes', async () => {
  const { io } = vaultIo(500000000n)
  wire(io, fakeChain('lands').chain)
  const paused = await act('pause', { paused: true }, agent, 'agent')
  expect(paused.body['outcome']).toBe('paused')
  expect(paused.body['message']).toMatch(/Jupiter order already placed keep running/)
  try {
    expect((await buy(MEDIAN, {}, agent, 'agent')).body['message']).toMatch(/paused new buys/)
    await expect(
      callTool('prepare_swap', { ...SWAP, owner: OWNER, agent: AGENT }, io),
    ).rejects.toThrow(/paused new buys/)
    expect((await buy(MEDIAN)).body['outcome']).toBe('sign')
    expect((await act('pause', { paused: false }, agent, 'agent')).status).toBe(403)
  } finally {
    expect((await act('pause', { paused: false })).body['outcome']).toBe('resumed')
  }
  expect((await buy(MEDIAN, {}, agent, 'agent')).body['outcome']).toBe('sign')
})

test('cancel hands the Jupiter order to the owner wallet that placed it', async () => {
  const { io } = vaultIo(500000000n)
  const m = wire(io, fakeChain('lands').chain)
  const order = Keypair.generate().publicKey.toBase58()
  const out = await act('cancel', { order }, agent, 'agent')
  expect(out.body['outcome']).toBe('owner')
  expect(out.body['ownerLink']).toContain(`cancel=${order}`)
  expect(m.rows.at(-1)?.action).toBe('cancel')
})

// ---- Who may press, and where. ----

test('every action is refused off the fork, naming T-D04, before anything is read', async () => {
  const { io, calls } = vaultIo(500000000n)
  wire(io, fakeChain('lands').chain)
  process.env['AGON_NETWORK'] = 'mainnet'
  for (const action of ['buy', 'sell', 'cancel', 'pause', 'approve', 'decline', 'send']) {
    const out = await post(`/actions/${action}`, {})
    expect(out.status).toBe(403)
    expect(out.body['error']).toMatch(/T-D04/)
  }
  expect(calls).toEqual([])
})

test('a send to a chain that is not the fork is refused, even with the deployment saying fork', async () => {
  const { io } = vaultIo(500000000n)
  const { chain, sent } = fakeChain('mainnet')
  wire(io, chain)
  const out = await signAndSend((await buy(MEDIAN)).body)
  expect(out.body['outcome']).toBe('refused')
  expect(out.body['message']).toMatch(/T-D04/)
  expect(sent).toHaveLength(0)
})

test('only a fresh signature by the owner or a hired key acts: stranger, stale, replayed and forged get 401', async () => {
  const { io, calls } = vaultIo(500000000n)
  wire(io, fakeChain('lands').chain)
  expect((await buy(MEDIAN, {}, stranger, 'agent')).status).toBe(401)
  expect((await buy(MEDIAN, {}, agent, 'owner-web')).status).toBe(401)
  // From /code-review: the daemon and the agent hold the same hired key, so a hired key calling
  // itself the owner would confirm its own unsure and lift its own pause. Powers follow the key.
  expect((await buy(MEDIAN, { confirmUnsure: true }, agent, 'owner-terminal')).status).toBe(401)
  expect((await act('pause', { paused: false }, agent, 'owner-terminal')).status).toBe(401)
  const stale = new Date(Date.now() - 61_000).toISOString()
  expect((await act('pause', { paused: true }, owner, 'owner-terminal', stale)).status).toBe(401)

  const request = {
    owner: OWNER,
    actor: 'agent',
    actorKey: AGENT,
    paused: true,
    at: new Date().toISOString(),
  }
  const signature = signText(agent, actionText('pause', request))
  const forged = await post('/actions/pause', { ...request, paused: false, signature })
  expect(forged.status).toBe(401)
  expect((await post('/actions/pause', { ...request, signature })).status).toBe(200)
  expect((await post('/actions/pause', { ...request, signature })).status).toBe(401)
  await act('pause', { paused: false })
  expect(calls).not.toContain('build')
})

// ---- The same calls against a real fork, with live quotes and the real guard. ----

const RPC = process.env['AGON_FORK_RPC_URL']
const onFork =
  RPC !== undefined &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(RPC) &&
  process.env['AGON_NET_MODE'] === 'live' &&
  Boolean(process.env['HELIUS_API_KEY']) &&
  Boolean(process.env['JUPITER_API_KEY'])

test.skipIf(!onFork)(
  'on the fork: over the cap is the owner link, exactly the cap lands, pause and cancel answer, all over HTTP',
  async () => {
    // Deep import: the arming flow the page runs, so this vault is armed the way a user arms one.
    const { arm } = (await import('@agon/web/dist/arm-flow.js' as string)) as {
      arm: (
        c: Connection,
        r: {
          owner: PublicKey
          agent: PublicKey
          depositLamports: bigint
          cap: bigint
          window: bigint
        },
        sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
      ) => Promise<unknown>
    }
    const c = new Connection(RPC as string, 'confirmed')
    process.env['AGON_RPC_URL'] = RPC
    const user = Keypair.generate()
    const key = Keypair.generate()
    await c.confirmTransaction(await c.requestAirdrop(user.publicKey, 2e9), 'confirmed')
    await arm(
      c,
      {
        owner: user.publicKey,
        agent: key.publicKey,
        depositLamports: 100_000_000n,
        cap: MEDIAN,
        window: 1000n,
      },
      async (tx) => {
        tx.sign([user])
        return tx
      },
    )
    const m = memory()
    wire(liveIo(), c as unknown as ActionChain, m, { waitMs: 30_000 })
    const as = (action: string, fields: Record<string, unknown>) => {
      const request = {
        owner: user.publicKey.toBase58(),
        actor: 'agent',
        actorKey: key.publicKey.toBase58(),
        ...fields,
        at: new Date().toISOString(),
      }
      return post(`/actions/${action}`, {
        ...request,
        signature: signText(key, actionText(action, request)),
      })
    }
    const trade = { mint: USDC, historyWallet: SWAP.historyWallet, slippageBps: 50 }

    const over = await as('buy', { ...trade, amount: String(MEDIAN + 1n) })
    expect(over.body['outcome'], JSON.stringify(over.body)).toBe('owner')

    const cleared = await as('buy', { ...trade, amount: String(MEDIAN) })
    expect(cleared.body['outcome'], JSON.stringify(cleared.body)).toBe('sign')
    const landed = await signAndSend(cleared.body, key)
    expect(landed.body['outcome'], JSON.stringify(landed.body)).toBe('confirmed')
    const signature = String(landed.body['signature'])
    expect((await c.getSignatureStatuses([signature])).value[0]?.err).toBeNull()

    expect((await as('sell', { ...trade, amount: '1000' })).body['outcome']).not.toBe('sign')
    expect((await as('pause', { paused: true })).body['outcome']).toBe('paused')
    expect((await as('buy', { ...trade, amount: '1' })).body['message']).toMatch(/paused/)
    // The agent paused itself, and only an owner resumes, so the test lifts it directly.
    setPaused(user.publicKey.toBase58(), null)
    expect(
      (await as('cancel', { order: Keypair.generate().publicKey.toBase58() })).body['outcome'],
    ).toBe('owner')
    expect(m.rows.map((r) => r.status)).toContain('confirmed')
  },
  240_000,
)
