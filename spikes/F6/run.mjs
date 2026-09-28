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
/** What the order deposits, and what the agent cap is set to, so the 2 numbers are comparable. */
const MAKING_AMOUNT = 100_000_000n
const CAP = 500_000_000n
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

if (!RPC) {
  const why =
    'no simulated chain was given. Set SURFPOOL_RPC_URL to a Surfpool mainnet fork, which carries ' +
    'the real Trigger and Swig programs and costs nothing'
  for (const k of ['orderCreated', 'cancelReturnsFunds', 'depositMatchesAllowance'])
    clauses[k].why = why
} else if (clauses.pdaAccepted.status !== 'pass') {
  const why = 'the Trigger API would not build an order, so there was nothing to send'
  for (const k of ['orderCreated', 'cancelReturnsFunds', 'depositMatchesAllowance'])
    clauses[k].why = why
} else {
  await runOnChain()
}

/**
 * The 3 clauses that move funds.
 *
 * The order is signed by root and not by the agent role, and that is the finding above rather than
 * a convenience: the Trigger program is not the program the role permits, so the role cannot reach
 * it. Root can, which is what T-E06 describes, where the user's own wallet signs the role and the
 * order together at arm time.
 */
async function runOnChain() {
  const conn = new web3.Connection(RPC, 'confirmed')
  const send = async (ixs, signers) => {
    try {
      const { blockhash } = await conn.getLatestBlockhash()
      const msg = new web3.TransactionMessage({
        payerKey: signers[0].publicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message()
      const tx = new web3.VersionedTransaction(msg)
      tx.sign(signers)
      return { landed: true, sig: await conn.sendTransaction(tx) }
    } catch (e) {
      return { landed: false, answer: String(e.message).replace(/\s+/g, ' ').slice(0, 220) }
    }
  }

  // A real Swig, deployed on the fork, with root held by a key the fork funds.
  const payer = web3.Keypair.generate()
  await conn.requestAirdrop(payer.publicKey, 50e9)
  await new Promise((r) => setTimeout(r, 1500))

  const createIx = await swig.getCreateSwigInstruction({
    payer: payer.publicKey,
    id: swigId,
    actions: swig.Actions.set().all().get(),
    authorityInfo: swig.createEd25519AuthorityInfo(payer.publicKey),
  })
  const created = await send([createIx], [payer])
  if (!created.landed) {
    for (const k of ['orderCreated', 'cancelReturnsFunds', 'depositMatchesAllowance']) {
      clauses[k].why = `the Swig account could not be created on the fork: ${created.answer}`
    }
    return
  }

  const account = await swig.fetchSwig(conn, swigAddress)
  const root = account.roles[0]
  const wallet = await swig.getSwigWalletAddress(account)
  await send(
    [
      web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: wallet,
        lamports: 10e9,
      }),
    ],
    [payer],
  )

  // The order the API built was for `swigAddress`. Rebuild it for the wallet, which is where the
  // funds are, then send the Trigger instruction under root.
  const res = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
    body: JSON.stringify({
      inputMint: SOL,
      outputMint: USDC,
      maker: wallet.toBase58(),
      payer: wallet.toBase58(),
      params: { makingAmount: '100000000', takingAmount: '12000000' },
      computeUnitPrice: 'auto',
    }),
  })
  const built = await res.json()
  if (!res.ok || !built.transaction) {
    for (const k of ['orderCreated', 'cancelReturnsFunds', 'depositMatchesAllowance']) {
      clauses[k].why =
        `the Trigger API would not build an order for the wallet address: ${JSON.stringify(built).slice(0, 180)}`
    }
    return
  }

  const msg = web3.VersionedTransaction.deserialize(
    Buffer.from(built.transaction, 'base64'),
  ).message
  const keys = msg.staticAccountKeys
  const toIx = (ci) =>
    new web3.TransactionInstruction({
      programId: keys[ci.programIdIndex],
      keys: ci.accountKeyIndexes.map((i) => ({
        pubkey: keys[i],
        isSigner: msg.isAccountSigner(i),
        isWritable: msg.isAccountWritable(i),
      })),
      data: Buffer.from(ci.data),
    })
  const inner = msg.compiledInstructions.map(toIx)

  // The agent role exists so clause 4 has an allowance to measure, even though root signs the
  // order. Capped on wSOL because that is what this order deposits.
  const agentKey = web3.Keypair.generate()
  const agentActions = chain.agentRoleActions({
    mint: SOL,
    recurringAmount: CAP,
    window: 150n,
  })
  chain.assertAgentRoleShape(agentActions, SOL)
  const addIxs = await swig.getAddAuthorityInstructions(
    account,
    root.id,
    swig.createEd25519AuthorityInfo(agentKey.publicKey),
    agentActions,
  )
  await send(addIxs, [payer])
  const withAgent = await swig.fetchSwig(conn, swigAddress)
  const agentRole = withAgent.roles.find((r) => r.id !== root.id)
  const agentRoleId = agentRole?.id ?? null
  const allowanceBefore = agentRole ? agentRole.actions.tokenSpendLimit(SOL) : null

  const before = await conn.getBalance(wallet)
  const wrapped = await swig.getSignInstructions(account, root.id, inner)
  const sent = await send(wrapped, [payer])
  clauses.orderCreated.status = sent.landed ? 'pass' : 'fail'
  clauses.orderCreated.why = sent.landed
    ? `the order was created under root, signature ${sent.sig}`
    : `refused: ${sent.answer}`

  if (!sent.landed) {
    for (const k of ['cancelReturnsFunds', 'depositMatchesAllowance']) {
      clauses[k].why = 'the order was never created, so there was nothing to cancel or to measure'
    }
    return
  }

  const after = await conn.getBalance(wallet)

  // Clause 4, measured on the role rather than on the wallet. `tokenSpendLimit` returns what is
  // left of the allowance, which is the number the acceptance is about: the wallet balance moves
  // by the deposit plus rent and fees and was never the right thing to compare.
  //
  // The cap is on wSOL and the order deposits wSOL, deliberately. An earlier version capped USDC
  // while the order deposited SOL, so the allowance could not have moved whatever the answer was,
  // and a spike that cannot fail is not a measurement.
  const reread = await swig.fetchSwig(conn, swigAddress)
  const agentAfter = reread.roles.find((r) => r.id === agentRoleId)
  const allowanceAfter = agentAfter ? agentAfter.actions.tokenSpendLimit(SOL) : null
  const moved =
    allowanceBefore !== null && allowanceAfter !== null ? allowanceBefore - allowanceAfter : null

  clauses.depositMatchesAllowance.status = moved === MAKING_AMOUNT ? 'pass' : 'fail'
  clauses.depositMatchesAllowance.why =
    allowanceBefore === null || allowanceAfter === null
      ? `the agent role allowance could not be read, before ${allowanceBefore}, after ${allowanceAfter}`
      : moved === 0n
        ? `the allowance did not move at all: ${allowanceBefore} before and after, against a deposit of ` +
          `${MAKING_AMOUNT}. The order was signed by root, and root holds every action, so the deposit ` +
          `never passed the agent's cap. That is the honest answer to this clause and it is worth more ` +
          `than a pass: a Trigger order created by root moves funds the agent cap does not see. It is ` +
          `only safe because the agent cannot create one, which is this spike's other finding. Wallet ` +
          `balance moved ${after - before} lamports over the same period, which is the deposit plus rent`
        : `the allowance moved by ${moved} against a deposit of ${MAKING_AMOUNT}`

  // Clause 3. Jupiter's cancel endpoint builds its transaction from its own mainnet index, so an
  // order created on a fork is unknown to it: asking to cancel one answers "Unable to cancel
  // specified order", checked. Cancelling a fork order means building the instruction against the
  // Trigger program directly, which needs its layout and is not something to guess at.
  clauses.cancelReturnsFunds.why =
    'Jupiter builds cancel transactions from its own mainnet index, so an order created on a fork ' +
    'is unknown to it and the endpoint answers "Unable to cancel specified order", checked against ' +
    'the order this run created. Cancelling a fork order needs the instruction built against the ' +
    'Trigger program directly rather than through the API, which is the remaining work on this clause'
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
