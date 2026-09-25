// F6: can a Jupiter Trigger order be owned by a Swig wallet, and does its vault deposit come out
// of the Swig allowance exactly?
//
//   JUPITER_API_KEY=... node spikes/F6/run.mjs
//   SURFPOOL_RPC_URL=http://127.0.0.1:8899 JUPITER_API_KEY=... node spikes/F6/run.mjs
//
// The 24/7 claim rests on this. A rule that runs without our servers is a Trigger order sitting on
// chain; if that order cannot be owned by the user's Swig wallet, the fallback is our own daemon
// polling price, and the UI has to say "runs while your computer is on" instead.
//
// The first clause is answerable without a chain and is checked first, because a refusal there
// makes the rest unreachable. The clauses that move funds need a chain and are marked "not run"
// with their reason when there is not one, rather than being quietly skipped.

import { createRequire } from 'node:module'
import { realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))

const chain = await import(pathToFileURL(`${repo}packages/chain/dist/index.js`).href)
const entry = realpathSync(`${repo}packages/chain/node_modules/@swig-wallet/classic/dist/index.js`)
const web3 = createRequire(entry)('@solana/web3.js')
const swig = await import(pathToFileURL(entry).href)

const KEY = process.env['JUPITER_API_KEY'] ?? ''
const RPC = process.env['SURFPOOL_RPC_URL'] ?? ''
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const clauses = {
  pdaAccepted: {
    states: 'the Trigger API builds an order with a Swig wallet as maker',
    status: 'not run',
    why: '',
  },
  orderCreated: { states: 'the order is created on a simulated chain', status: 'not run', why: '' },
  cancelReturnsFunds: { states: 'a cancel returns the funds', status: 'not run', why: '' },
  depositMatchesAllowance: {
    states: 'the vault deposit reduces the Swig allowance by exactly the deposit',
    status: 'not run',
    why: '',
  },
}

/** The Swig wallet the order would belong to. Derived, not deployed: clause 1 needs an address. */
const swigId = crypto.getRandomValues(new Uint8Array(32))
const swigAddress = swig.findSwigPda(swigId)

let orderProgram = null
let orderAddress = null

try {
  const res = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
    body: JSON.stringify({
      inputMint: SOL,
      outputMint: USDC,
      maker: swigAddress.toBase58(),
      payer: swigAddress.toBase58(),
      params: { makingAmount: '100000000', takingAmount: '12000000' },
      computeUnitPrice: 'auto',
    }),
  })
  const body = await res.json()
  if (!res.ok || !body.transaction) {
    clauses.pdaAccepted.why = `the Trigger API answered ${res.status}: ${JSON.stringify(body).slice(0, 200)}`
  } else {
    orderAddress = body.order ?? null
    const msg = web3.VersionedTransaction.deserialize(
      Buffer.from(body.transaction, 'base64'),
    ).message
    // Which program actually runs is the part that decides who may create an order, so it is read
    // off the transaction rather than assumed from the endpoint's name.
    const programs = msg.compiledInstructions
      .map((ix) => msg.staticAccountKeys[ix.programIdIndex])
      .filter(Boolean)
      .map((p) => p.toBase58())
    orderProgram = programs[programs.length - 1] ?? null
    clauses.pdaAccepted.status = 'pass'
    clauses.pdaAccepted.why =
      `the API built an order with the Swig wallet as maker and payer, order ${orderAddress}, ` +
      `invoking ${orderProgram}`
  }
} catch (e) {
  clauses.pdaAccepted.why = `the Trigger API could not be reached: ${String(e.message).slice(0, 180)}`
}

/**
 * The finding that outranks the rest of this spike.
 *
 * The agent role is `programLimit(Jupiter)` and nothing else, so it permits exactly 1 program.
 * The Trigger program is a different one. If those two ids differ then an agent holding the role
 * cannot create, cancel or amend a Trigger order, and the PRD's "a Swig role plus a Jupiter Trigger
 * order in 1 flow" only works because T-E06 has the user's own wallet sign it at arm time. That is
 * a design constraint worth knowing before someone builds an agent that expects to manage orders.
 */
const rolePermits = chain.JUPITER_PROGRAM_ID
const triggerIsTheSameProgram = orderProgram !== null && orderProgram === rolePermits

const onChain = RPC
  ? null
  : 'no simulated chain was given. Set SURFPOOL_RPC_URL to a Surfpool mainnet fork, which carries the real Trigger and Swig programs and costs nothing'
if (onChain) {
  for (const k of ['orderCreated', 'cancelReturnsFunds', 'depositMatchesAllowance']) {
    clauses[k].why = onChain
  }
}

const passed = Object.values(clauses).filter((c) => c.status === 'pass').length
const pass = passed === Object.keys(clauses).length

writeFileSync(
  `${here}result.json`,
  `${JSON.stringify(
    {
      id: 'F6',
      pass,
      date: new Date().toISOString().slice(0, 10),
      measured:
        `${passed} of ${Object.keys(clauses).length} clauses pass. ` +
        (clauses.pdaAccepted.status === 'pass'
          ? `A Trigger order can be built with a Swig wallet, a program-derived address, as maker and payer. `
          : `The Trigger API would not build an order for a Swig wallet. `) +
        (orderProgram
          ? `The order invokes ${orderProgram}, and the agent role permits ${rolePermits}, so they are ` +
            `${triggerIsTheSameProgram ? 'the same program' : 'NOT the same program'}.`
          : ''),
      triggerProgram: orderProgram,
      agentRolePermits: rolePermits,
      agentRoleCouldManageOrders: triggerIsTheSameProgram,
      orderAddress,
      swigWallet: swigAddress.toBase58(),
      clauses,
    },
    null,
    2,
  )}\n`,
)

console.log(
  `F6: ${pass ? 'PASS' : 'FAIL'}, ${passed} of ${Object.keys(clauses).length} clauses. ` +
    `Trigger program ${orderProgram}, role permits ${rolePermits}. Wrote result.json.`,
)
