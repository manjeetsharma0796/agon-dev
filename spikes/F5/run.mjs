// F5: does the Swig role actually enforce the cap, on devnet?
//
//   node scripts/spike.mjs F5 --devnet
//   DEVNET_KEYPAIR=<64-number json array, or a path to one> node scripts/spike.mjs F5 --devnet
//
// This is the existential spike. If the cap does not hold on-chain then the custody story is gone,
// so nothing here is softened and nothing here is mocked. Every number below is read from devnet in
// this process, and the run writes `"pass": false` with what it measured rather than a green row it
// did not earn.
//
// The role under test is the production one. `agentRoleActions` and `assertAgentRoleShape` are
// imported from packages/chain, not copied, because a spike that reimplements the thing it measures
// measures the reimplementation.
//
// The keypair is generated in memory and never written anywhere. A devnet throwaway is worth
// nothing, but a keypair file in the repo is a habit worth nothing either, and the secret scan is a
// hard gate.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../', import.meta.url))

// Relative into dist, not by package name: spikes/ is not a workspace package, so the root has no
// @agon/* link to resolve. Both workflows that run a spike do `pnpm build` first.
const chainDist = `${repo}packages/chain/dist/index.js`
if (!existsSync(chainDist)) {
  console.error(
    `F5: packages/chain is not built, so ${chainDist} does not exist. Run \`pnpm build\` and try again.`,
  )
  process.exit(1)
}
const { JUPITER_PROGRAM_ID, SWIG_PROGRAM_ID, agentRoleActions, assertAgentRoleShape } =
  await import(pathToFileURL(chainDist).href)

// @solana/web3.js is a peer of @swig-wallet/classic, so pnpm keeps it beside that package rather
// than anywhere spikes/ can reach. Resolving through the real path of the SDK entry point, not the
// symlink, is what lets node walk up into the store directory the SDK actually loads it from. Doing
// it any other way means a second copy of web3.js, and two copies do not share a PublicKey.
const classicEntry = `${repo}packages/chain/node_modules/@swig-wallet/classic/dist/index.js`
const web3 = createRequire(realpathSync(classicEntry))('@solana/web3.js')
const swig = await import(pathToFileURL(classicEntry).href)

const RPC = process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'

// Every faucet we know of, so a refusal is a measurement of the faucets and not of one of them.
// The api key, when there is one, stays out of the recorded answer.
const heliusKey = process.env.HELIUS_API_KEY ?? ''
/**
 * What to call the chain in the result. It used to be the literal word "devnet" in 3 places, which
 * was true while devnet was the only target and became a lie the moment OP-20 moved this to a
 * mainnet fork: the run would have reported measurements "on devnet" that were taken somewhere
 * else. A result that misnames the chain it ran against is worse than no result.
 */
const CHAIN = /127\.0\.0\.1|localhost/.test(RPC)
  ? 'a local mainnet fork'
  : RPC.includes('devnet')
    ? 'devnet'
    : RPC

const FAUCETS = [
  // The chain under test comes first, because on a Surfpool fork it is also the faucet and it
  // always says yes. That is the whole reason OP-20 moved this spike off devnet: 7 devnet faucets
  // refused, and a fork airdrops its own SOL with no key, no allowance and nobody to ask. On
  // devnet this entry is api.devnet.solana.com, which is the next line anyway, so it costs a
  // duplicate attempt there and unblocks the run everywhere else.
  ['the configured RPC', RPC],
  ['api.devnet.solana.com', 'https://api.devnet.solana.com'],
  ...(heliusKey
    ? [['devnet.helius-rpc.com', `https://devnet.helius-rpc.com/?api-key=${heliusKey}`]]
    : []),
  ['solana-devnet.g.alchemy.com', 'https://solana-devnet.g.alchemy.com/v2/demo'],
  ['solana-devnet-rpc.publicnode.com', 'https://solana-devnet-rpc.publicnode.com'],
  ['solana-devnet.drpc.org', 'https://solana-devnet.drpc.org'],
  ['api.blockeden.xyz', 'https://api.blockeden.xyz/solana/devnet'],
  ['solana-devnet.gateway.tatum.io', 'https://solana-devnet.gateway.tatum.io'],
]

// Wrapped SOL. A real devnet mint, so the role under test carries a real cap on a real mint rather
// than a placeholder that would never be accepted.
const MINT = 'So11111111111111111111111111111111111111112'
// 0.5 wSOL per 150 slots, about a minute. Small on purpose: case (e) waits out a window.
const CAP = 500_000_000n
const WINDOW = 150n
// create, addAuthority, then one for each of (a) to (f).
const TRANSACTIONS_IN_THE_SEVEN_CASES = 8
const LAMPORTS_PER_SIGNATURE = 5000
// A Swig carrying a root role and the agent role. Measured, not guessed: of the 59,948 Swig
// accounts on devnet, 49,693 sit at the 104-byte rent tier (one role) and 8,661 at 168 bytes (two).
const TWO_ROLE_SWIG_BYTES = 168

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// Pinned, because the fork's copy of a pool is frozen at first touch while Jupiter quotes the live
// one. On a venue whose price moves with an oracle the two drift apart within seconds and the swap
// fails inside Jupiter, which reads exactly like the cap refusing. Measured: on a fork 5 hours old
// every swap at 50 bps failed that way, (b) included, and that run proved nothing.
const VENUE = 'Raydium CLMM'
const SLIPPAGE_BPS = 300
/** Case (e) only, so its probes meet a pool this run has not moved. */
const PROBE_VENUE = 'Whirlpool'

/**
 * A wallet cannot hold an SPL token directly: each mint needs its own account owned by the wallet.
 * Phantom creates these silently and a Swig vault has nobody to do it, which is what left (a), (b)
 * and (e) unrunnable. The owner creates them, because the associated-token program requires only
 * the PAYER to sign and treats the owner as a read-only account. So a vault with no key gets its
 * accounts without signing anything, and the agent's role never touches the token programs.
 *
 * Built by hand: the repo has no SPL token library and these are 6 accounts and 1 byte, and 1
 * account and 1 byte. A dependency for that would be more code to audit, not less.
 */
const pocketOf = (owner, mint) =>
  web3.PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      new web3.PublicKey(TOKEN_PROGRAM).toBuffer(),
      new web3.PublicKey(mint).toBuffer(),
    ],
    new web3.PublicKey(ATA_PROGRAM),
  )[0]

/** Associated-token `CreateIdempotent`, instruction 1. Only the payer signs. */
const createPocket = (payerKey, owner, mint) =>
  new web3.TransactionInstruction({
    programId: new web3.PublicKey(ATA_PROGRAM),
    data: Buffer.from([1]),
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: pocketOf(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: new web3.PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new web3.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ],
  })

/** Token `SyncNative`, instruction 17: count the lamports sitting in a wSOL account as wSOL. */
const syncNative = (pocket) =>
  new web3.TransactionInstruction({
    programId: new web3.PublicKey(TOKEN_PROGRAM),
    data: Buffer.from([17]),
    keys: [{ pubkey: pocket, isSigner: false, isWritable: true }],
  })

/**
 * Which program refused, innermost first.
 *
 * This is the difference between evidence and an anecdote. A refusal by Jupiter, for slippage on a
 * drifted pool, looks identical from the outside to the cap holding. Measured both ways: on a
 * fresh fork the only `failed` line is Swig's at depth 1, and on a stale one Jupiter's appears at
 * depth 2 before it. So the first `failed` line is the one that decides.
 */
const refusedBy = (logs) => {
  for (const line of logs ?? []) {
    const m = /^Program (\S+) failed/.exec(line)
    if (m) return m[1]
  }
  return null
}

/** Jupiter's keyless API allows 10 requests per 10 s, so a burst reads a 429 as an answer. */
let lastJupiterCall = 0
const jupiter = async (path, init) => {
  for (let attempt = 1; ; attempt++) {
    const wait = lastJupiterCall + 1200 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastJupiterCall = Date.now()
    const res = await fetch(`https://api.jup.ag/swap/v1/${path}`, init)
    const body = await res.json().catch(() => ({}))
    if (res.status === 429 && attempt < 6) {
      await new Promise((r) => setTimeout(r, 4000 * attempt))
      continue
    }
    if (!res.ok) {
      throw new Error(
        `Jupiter ${res.status} on ${path.split('?')[0]}: ${JSON.stringify(body).slice(0, 200)}`,
      )
    }
    return body
  }
}

const connection = new web3.Connection(RPC, 'confirmed')

/**
 * Take every api key out of a string before it is recorded or printed.
 *
 * Two separate leaks, both of which end in a committed file. The Helius key is interpolated into a
 * faucet URL, and fetch puts the URL it failed on into its own error message. And `DEVNET_RPC_URL`
 * is exactly what a person sets when the public devnet RPC rate-limits them, which means they set
 * it to a keyed endpoint, and web3.js quotes that endpoint back in its errors too. So this strips
 * the key we know by value and any `api-key` or `apiKey` query parameter by shape, and result.json
 * records the RPC origin rather than the URL.
 */
const redact = (s) => {
  const withoutKnownKey = heliusKey ? String(s).split(heliusKey).join('<api key>') : String(s)
  return withoutKnownKey.replace(
    /([?&](?:api[-_]?key|access[-_]?token)=)[^&\s"'<>]+/gi,
    '$1<api key>',
  )
}
const rpcOrigin = (() => {
  try {
    return new URL(RPC).origin
  } catch {
    return redact(RPC)
  }
})()

/** What devnet says about a pinned program id. Read from the chain, never from our config. */
async function programOnDevnet(id) {
  const info = await connection.getAccountInfo(new web3.PublicKey(id))
  if (info === null) {
    return { id, exists: false, executable: false, owner: null, bytes: 0, lamports: 0 }
  }
  return {
    id,
    exists: true,
    executable: info.executable,
    owner: String(info.owner),
    bytes: info.data.length,
    lamports: info.lamports,
  }
}

/**
 * The signer for the run.
 *
 * `DEVNET_KEYPAIR` is the nightly job's secret (OP-19) and holds the 64-number array
 * `solana-keygen` writes, either inline or as a path to such a file. Anything else, and the run
 * makes its own throwaway and asks the faucets, which is the path a person running this by hand
 * takes. Neither one is ever written to disk or printed.
 */
function signer() {
  const raw = (process.env.DEVNET_KEYPAIR ?? '').trim()
  if (raw === '') return { keypair: web3.Keypair.generate(), source: 'generated in memory' }
  const text = raw.startsWith('[') ? raw : readFileSync(raw, 'utf8')
  let bytes
  try {
    bytes = Uint8Array.from(JSON.parse(text))
  } catch {
    // Deliberately not `e.message`. V8 quotes a slice of the input it failed on, and the input
    // here is a private key, so the parse error would print key material into the CI log.
    throw new Error(
      'DEVNET_KEYPAIR is neither a 64-number json array nor a path to one, and it did not parse ' +
        'as json. Write it the way solana-keygen does, and keep it out of the repo. Its contents ' +
        'are not echoed here on purpose.',
    )
  }
  if (bytes.length !== 64) {
    throw new Error(
      `DEVNET_KEYPAIR holds ${bytes.length} bytes, expected 64. Use the file solana-keygen writes.`,
    )
  }
  return { keypair: web3.Keypair.fromSecretKey(bytes), source: 'DEVNET_KEYPAIR' }
}

async function askFaucets(address) {
  const attempts = []
  for (const [name, url] of FAUCETS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'requestAirdrop',
          params: [address, web3.LAMPORTS_PER_SOL],
        }),
        signal: AbortSignal.timeout(30_000),
      })
      attempts.push({
        faucet: name,
        http: res.status,
        answer: redact((await res.text()).trim()).slice(0, 300),
      })
    } catch (e) {
      attempts.push({ faucet: name, http: 0, answer: redact(e.message).slice(0, 300) })
    }
  }
  return attempts
}

const cases = {
  a: { states: 'swap within cap succeeds', status: 'not run', why: '' },
  b: { states: 'swap over cap rejected', status: 'not run', why: '' },
  c: { states: 'transfer to an arbitrary address rejected', status: 'not run', why: '' },
  d: { states: 'call to a non-Jupiter program rejected', status: 'not run', why: '' },
  e: {
    states: 'allowance restored at the expected slot after the window',
    status: 'not run',
    why: '',
  },
  f: {
    states: 'root removes the role and the next agent transaction fails',
    status: 'not run',
    why: '',
  },
  g: { states: 'removal done from Phantom and not only our CLI', status: 'not run', why: '' },
}

const swigProgram = await programOnDevnet(SWIG_PROGRAM_ID)
const jupiterProgram = await programOnDevnet(JUPITER_PROGRAM_ID)
const slot = await connection.getSlot()

// The production role, built by packages/chain and checked by packages/chain. No network in either,
// so this is the same verdict the guard reaches, reached here before anything is signed.
const agentActions = agentRoleActions({ mint: MINT, recurringAmount: CAP, window: WINDOW })
assertAgentRoleShape(agentActions, MINT)

const { keypair: payer, source: keySource } = signer()
const swigId = crypto.getRandomValues(new Uint8Array(32))
const swigAddress = swig.findSwigPda(swigId)

// The first transaction of the seven cases, built for real. The root authority is the human's key,
// which is what removes the role in (f) and in (g).
const createIx = await swig.getCreateSwigInstruction({
  payer: payer.publicKey,
  id: swigId,
  actions: swig.Actions.set().all().get(),
  authorityInfo: swig.createEd25519AuthorityInfo(payer.publicKey),
})
const { blockhash } = await connection.getLatestBlockhash()
const message = new web3.TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: blockhash,
  instructions: [createIx],
}).compileToV0Message()
const createTx = new web3.VersionedTransaction(message)
createTx.sign([payer])

const rentForTwoRoles = await connection.getMinimumBalanceForRentExemption(TWO_ROLE_SWIG_BYTES)
const requiredLamports = rentForTwoRoles + LAMPORTS_PER_SIGNATURE * TRANSACTIONS_IN_THE_SEVEN_CASES
let balance = await connection.getBalance(payer.publicKey)

const faucetAttempts =
  balance < requiredLamports ? await askFaucets(payer.publicKey.toBase58()) : []
if (faucetAttempts.length > 0) balance = await connection.getBalance(payer.publicKey)

// Whatever happens next, devnet's own answer to the first real transaction goes in the result. It
// is what separates "our transaction is wrong" from "the account has no lamports", and those two
// need very different people to fix them.
let firstTransactionAnswer = ''
try {
  firstTransactionAnswer = `landed, signature ${await connection.sendTransaction(createTx)}`
} catch (e) {
  firstTransactionAnswer = redact(e.message).replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Case (g) is a person clicking Remove in Phantom. A script asserting that a person used a wallet
// is exactly the green row the board refuses, so it stays an operator step in OP-19.
cases.g.status = 'not run'
cases.g.why = 'needs a human with Phantom, recorded in OP-19, and no script can assert it'

// Jupiter is not deployed on devnet, which the seven cases were written before anyone checked.
const jupiterMissing = !jupiterProgram.executable
const jupiterWhy = jupiterMissing
  ? `the pinned Jupiter id ${JUPITER_PROGRAM_ID} is not a program on devnet: executable ${jupiterProgram.executable}, owner ${jupiterProgram.owner}, ${jupiterProgram.bytes} bytes. See OP-20`
  : ''

const funded = balance >= requiredLamports
if (!funded) {
  const why =
    `the payer holds ${balance} lamports and the seven cases need ${requiredLamports} ` +
    `(${rentForTwoRoles} rent for a two-role Swig plus ${LAMPORTS_PER_SIGNATURE} per transaction, ` +
    `${TRANSACTIONS_IN_THE_SEVEN_CASES} of them). Fund a devnet key, see OP-19`
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
    cases[k].status = 'not run'
    cases[k].why = why
  }
} else if (jupiterMissing) {
  // Funded, and still not runnable as written. (a), (b) and (e) all need an instruction that
  // reaches Jupiter and moves the capped mint; (c), (d) and (f) do not, but writing them against a
  // seven-case shape CP1 is about to change would be writing them twice.
  for (const k of ['a', 'b', 'e']) {
    cases[k].status = 'not run'
    cases[k].why = jupiterWhy
  }
  for (const k of ['c', 'd', 'f']) {
    cases[k].status = 'not run'
    cases[k].why =
      `waiting on the CP1 decision in OP-20 before the case sequence is written, because ${jupiterWhy}`
  }
} else {
  // Funded, and Jupiter is a real program. Both of the reasons this spike has ever been unable to
  // run are gone, which is new, and it leaves the case bodies as the only thing missing. Before
  // this branch existed the 6 cases fell through both tests above and were reported "not run" with
  // an empty reason, which is the blank field the catalogue forbids: it read as though something
  // had been checked and had no answer, rather than as nothing having been checked at all.
  //
  // (c), (d) and (f) ask only whether Swig authorises an instruction, so they need no swap and can
  // be written now. (a), (b) and (e) each need an instruction that actually reaches Jupiter and
  // moves the capped mint, because a tokenRecurringLimit is applied by comparing token balances
  // after the inner instructions run. A synthetic instruction to Jupiter's id would be rejected
  // inside Jupiter before the limit was ever consulted, and recording that as a cap holding would
  // be a measurement of the wrong thing.
  await runAuthorisationCases()
}

/**
 * Cases (c), (d) and (f): the 3 that ask only whether Swig authorises an instruction.
 *
 * None of them needs a swap. The agent role is `programLimit(Jupiter)` plus a
 * `tokenRecurringLimit`, and the program limit is checked before anything executes, so an
 * instruction aimed anywhere other than Jupiter is refused on authorisation alone. That is a
 * different question from whether the cap holds, which is (a), (b) and (e), and it is the half
 * that can be answered without a route.
 *
 * Each case asserts a refusal, and a refusal is only evidence if the thing could otherwise have
 * succeeded. So (f) removes the role and repeats (c): if (c) already failed for some unrelated
 * reason, (f) proves nothing and says so rather than counting itself a pass.
 */
async function runAuthorisationCases() {
  const send = async (instructions, signers) => {
    try {
      const { blockhash: recent } = await connection.getLatestBlockhash()
      const msg = new web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: recent,
        instructions,
      }).compileToV0Message()
      const tx = new web3.VersionedTransaction(msg)
      tx.sign(signers)
      return { landed: true, answer: await connection.sendTransaction(tx), by: null }
    } catch (e) {
      // `by` is the innermost program that failed, and it is what makes a refusal evidence. Without
      // it a slippage error from Jupiter and the cap holding are the same string to a reader.
      const logs =
        e.transactionLogs ??
        e.logs ??
        (typeof e.getLogs === 'function' ? await e.getLogs().catch(() => []) : [])
      return {
        landed: false,
        answer: redact(e.message).replace(/\s+/g, ' ').trim().slice(0, 300),
        by: refusedBy(logs),
        logs: (logs ?? []).filter((l) => /^Program \S+ (invoke|success|failed)/.test(l)),
      }
    }
  }

  /** Like `send`, but the first signer pays. (a), (b) and (e) are sent by the agent alone. */
  const sendAs = async (instructions, signers) => {
    try {
      const { blockhash: recent } = await connection.getLatestBlockhash()
      const msg = new web3.TransactionMessage({
        payerKey: signers[0].publicKey,
        recentBlockhash: recent,
        instructions,
      }).compileToV0Message()
      const tx = new web3.VersionedTransaction(msg)
      tx.sign(signers)
      return { landed: true, answer: await connection.sendTransaction(tx), by: null }
    } catch (e) {
      const logs =
        e.transactionLogs ??
        e.logs ??
        (typeof e.getLogs === 'function' ? await e.getLogs().catch(() => []) : [])
      return {
        landed: false,
        answer: redact(e.message).replace(/\s+/g, ' ').trim().slice(0, 300),
        by: refusedBy(logs),
        logs: (logs ?? []).filter((l) => /^Program \S+ (invoke|success|failed)/.test(l)),
      }
    }
  }

  // The agent gets its own key, because the whole claim is that this key can do less than the
  // root one. Giving it the payer's key would prove nothing about either.
  const agent = web3.Keypair.generate()
  let swigAccount
  try {
    swigAccount = await swig.fetchSwig(connection, swigAddress)
  } catch (e) {
    const why = `the Swig account could not be read back after creation: ${redact(e.message).slice(0, 160)}`
    for (const k of ['c', 'd', 'f']) cases[k].why = why
    return
  }

  const rootRole = swigAccount.roles[0]
  const addIxs = await swig.getAddAuthorityInstructions(
    swigAccount,
    rootRole.id,
    swig.createEd25519AuthorityInfo(agent.publicKey),
    agentActions,
  )
  const added = await send(addIxs, [payer])
  if (!added.landed) {
    const why = `the agent role could not be added, so nothing below was testable: ${added.answer}`
    for (const k of ['c', 'd', 'f']) cases[k].why = why
    return
  }

  swigAccount = await swig.fetchSwig(connection, swigAddress)
  const agentRole = swigAccount.roles.find((r) => r.id !== rootRole.id)
  if (!agentRole) {
    const why = 'the agent role was added but does not read back on the account'
    for (const k of ['c', 'd', 'f']) cases[k].why = why
    return
  }

  // (c) A transfer to an arbitrary address. Not Jupiter, so the program limit alone should refuse
  // it, whatever the cap says.
  //
  // The source is the Swig wallet address and not `swigAccount.address`, which was the first
  // version of this and was wrong in a way that looked right. The account address holds the roles;
  // the funds sit at a separate PDA. Transferring from the wrong one is refused by the system
  // program for a missing signature, and that refusal has nothing to do with the program limit
  // this case exists to test. It counted as a pass and proved nothing, which is exactly the
  // failure the F5 notes warn about: a rejection for the wrong reason read as the cap holding.
  const stranger = web3.Keypair.generate().publicKey
  const swigWallet = await swig.getSwigWalletAddress(swigAccount)
  await send(
    [
      web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: swigWallet,
        lamports: 20_000_000,
      }),
    ],
    [payer],
  )
  const transferIx = web3.SystemProgram.transfer({
    fromPubkey: swigWallet,
    toPubkey: stranger,
    lamports: 1,
  })
  const cSigned = await swig.getSignInstructions(swigAccount, agentRole.id, [transferIx])
  const c = await send(cSigned, [payer, agent])
  // A refusal only counts when it is the refusal this case is about, so only a refusal by the Swig
  // program passes. This was a list of wrong reasons, and a list misses the next one: on a fork
  // whose upstream timed out, "Failed to fetch accounts from remote" passed (c) with no program
  // ever having run.
  const wrongReason = !(c.by ?? '').startsWith('swig')
  cases.c.status = c.landed ? 'fail' : wrongReason ? 'not run' : 'pass'
  cases.c.why = c.landed
    ? `the transfer to ${stranger.toBase58()} was authorised, signature ${c.answer}. The role is not holding`
    : wrongReason
      ? `refused, but for the wrong reason, so this is not evidence either way: ${c.answer}`
      : `refused: ${c.answer}`

  // (d) A non-Jupiter instruction that uses the vault's authority. Rewritten against the sentence
  // OP-28 decided on 2026-09-29, from "a call to a non-Jupiter program is rejected".
  //
  // The memo below is kept and still sent, because it is the observation that forced the rewrite
  // and deleting it would erase the evidence. It is recorded as a non-case rather than a failure:
  // 0xbbe is the same error Swig gives when Jupiter's own setup instructions are refused, so it
  // means the program is not permitted, and yet the memo, also not permitted, was authorised.
  // Both facts only hold together if the limit is conditional on the vault's authority being used.
  // The memo carries 0 accounts and no signer, so it cannot reach the vault at all.
  //
  // The case itself is an SPL `Approve`: it moves no value in the instruction and it hands a
  // delegate the right to drain the account afterwards, outside any window and outside the cap.
  // That is the instruction the old wording would have waved through.
  const memoIx = new web3.TransactionInstruction({
    keys: [],
    programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    data: Buffer.from('agon f5 case d, the non-case'),
  })
  const memo = await send(await swig.getSignInstructions(swigAccount, agentRole.id, [memoIx]), [
    payer,
    agent,
  ])

  const approveIx = new web3.TransactionInstruction({
    programId: new web3.PublicKey(TOKEN_PROGRAM),
    data: Buffer.concat([
      Buffer.from([4]),
      (() => {
        const amount = Buffer.alloc(8)
        amount.writeBigUInt64LE(1_000_000_000n)
        return amount
      })(),
    ]),
    keys: [
      { pubkey: pocketOf(swigWallet, MINT), isSigner: false, isWritable: true },
      { pubkey: web3.Keypair.generate().publicKey, isSigner: false, isWritable: false },
      { pubkey: swigWallet, isSigner: true, isWritable: false },
    ],
  })
  const dSigned = await swig.getSignInstructions(swigAccount, agentRole.id, [approveIx])
  const d = await send(dSigned, [payer, agent])
  // What this measured, rather than what it first looked like. (c) sends value through a non
  // Jupiter program and Swig refuses it with its own error. (d) sends a memo, which carries no
  // accounts and moves nothing, and Swig allows it. Together those say the program limit gates
  // value movement rather than every CPI, which is a coherent design and not a hole. It is also
  // not what this row's acceptance says, and that wording is a CP1 question rather than something
  // a spike settles for itself, so the case records the observation and fails rather than being
  // quietly reworded into a pass.
  const dWrongReason = !d.landed && d.by !== null && !d.by.startsWith('swig')
  cases.d.status = d.landed ? 'fail' : dWrongReason ? 'not run' : 'pass'
  cases.d.why = d.landed
    ? `an SPL Approve, which uses the vault as signer, was authorised under a role whose only ` +
      `program permission is Jupiter: signature ${d.answer}. The delegate could then drain the ` +
      `account outside any window and outside the cap, so the Jupiter-only role does not bound ` +
      `the agent`
    : dWrongReason
      ? `refused by ${d.by} rather than by Swig, so this is not evidence either way: ${d.answer}`
      : `refused by Swig: ${d.answer}. The memo control, 0 accounts and no signer, was ` +
        `${memo.landed ? 'authorised as expected' : `refused (${memo.answer}), which the decided sentence does not predict`}, ` +
        `which is the pair that produced the sentence: the limit gates what uses the vault's authority`

  // ---- (a), (b), a control and (e). These need a swap that really reaches Jupiter. ----
  //
  // A synthetic instruction aimed at Jupiter's id would be rejected inside Jupiter before the cap
  // was ever consulted, and recording that as the cap holding measures the wrong thing. So these
  // run a real route, and the vault needs somewhere to hold both sides of it first.
  const wsolPocket = pocketOf(swigWallet, MINT)
  const usdcPocket = pocketOf(swigWallet, USDC)

  // The 4 swaps spend 0.9 wSOL between them, and 2 token accounts cost 2,039,280 lamports of rent
  // each. The faucet loop above asks every source for 1 SOL, which covered the 6 cases that move
  // nothing and does not cover these. A fork answers requestAirdrop without limit, measured under
  // OP-19, so it tops itself up; a real devnet will refuse and the cases below say so rather than
  // reporting a funding shortfall as something about the cap.
  const NEEDED = 3_000_000_000
  let balance = await connection.getBalance(payer.publicKey)
  let toppedUp = null
  if (balance < NEEDED) {
    try {
      await connection.confirmTransaction(
        await connection.requestAirdrop(payer.publicKey, NEEDED - balance),
        'confirmed',
      )
      balance = await connection.getBalance(payer.publicKey)
      toppedUp = `topped up to ${balance} lamports`
    } catch (e) {
      toppedUp = `could not top up: ${redact(e.message).slice(0, 140)}`
    }
  }
  if (balance < NEEDED) {
    const why =
      `the payer holds ${balance} lamports against the ${NEEDED} these 4 swaps and 2 token ` +
      `accounts need, and ${toppedUp ?? 'no top-up was attempted'}. Nothing about the cap was measured`
    for (const k of ['a', 'b', 'e']) cases[k].why = why
  }

  const pockets =
    balance < NEEDED
      ? { landed: false, answer: 'not funded' }
      : await send(
          [
            createPocket(payer.publicKey, swigWallet, MINT),
            createPocket(payer.publicKey, swigWallet, USDC),
            web3.SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: wsolPocket,
              lamports: 1_000_000_000,
            }),
            syncNative(wsolPocket),
            // The agent pays for its own swaps, because the whole claim is about what THAT key may do.
            // It is funded by the owner rather than a faucet so this works on any chain, and with
            // fee money only: every lamport it could trade with sits in the vault behind the cap.
            web3.SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: agent.publicKey,
              lamports: 50_000_000,
            }),
          ],
          [payer],
        )

  const held = async (pocket) => {
    try {
      return BigInt((await connection.getTokenAccountBalance(pocket)).value.amount)
    } catch {
      return null
    }
  }
  /** The role as the SDK reads it, including `lastReset`, which our own TokenSpend omits today. */
  const spendNow = async () => {
    const now = await swig.fetchSwig(connection, swigAddress)
    const role = now.roles.find((r) => r.id === agentRole.id)
    return role ? role.actions.tokenSpend(MINT) : null
  }

  /**
   * One agent swap of `amount` wSOL into USDC, sent by the agent alone.
   *
   * Only Jupiter's `swapInstruction` goes through the role. Its setup and cleanup are dropped,
   * because the accounts already exist and the role permits neither the associated-token nor the
   * token program. `ComputeBudget` sits outside the wrap: the runtime reads it, it is not a
   * program call, and wrapping it is refused.
   */
  const agentSwap = async (amount, venue = VENUE) => {
    const quote = await jupiter(
      `quote?inputMint=${MINT}&outputMint=${USDC}&amount=${amount}` +
        `&slippageBps=${SLIPPAGE_BPS}&asLegacyTransaction=true&dexes=${encodeURIComponent(venue)}`,
    )
    const built = await jupiter('swap-instructions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: swigWallet.toBase58(),
        wrapAndUnwrapSol: false,
        asLegacyTransaction: true,
      }),
    })
    const fresh = await swig.fetchSwig(connection, swigAddress)
    const role = fresh.roles.find((r) => r.id === agentRole.id)
    const swapIx = new web3.TransactionInstruction({
      programId: new web3.PublicKey(built.swapInstruction.programId),
      data: Buffer.from(built.swapInstruction.data, 'base64'),
      keys: built.swapInstruction.accounts.map((a) => ({
        pubkey: new web3.PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
    })
    const wrapped = await swig.getSignInstructions(fresh, role.id, [swapIx])
    const before = {
      wsol: await held(wsolPocket),
      usdc: await held(usdcPocket),
      spend: await spendNow(),
    }
    const result = await sendAs(
      [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...wrapped],
      [agent],
    )
    const after = {
      wsol: await held(wsolPocket),
      usdc: await held(usdcPocket),
      spend: await spendNow(),
    }
    return {
      ...result,
      before,
      after,
      quoted: BigInt(quote.outAmount),
      route: quote.routePlan.map((r) => r.swapInfo.label).join(' > '),
    }
  }

  if (!pockets.landed) {
    if (balance >= NEEDED) {
      const why = `the vault's token accounts could not be created, so no swap was possible: ${pockets.answer}`
      for (const k of ['a', 'b', 'e']) cases[k].why = why
    }
  } else {
    let a, b, control
    try {
      a = await agentSwap(100_000_000n)
      b = await agentSwap(450_000_000n)
      control = await agentSwap(350_000_000n)
    } catch (e) {
      const why = `Jupiter could not be reached, so nothing about the cap was measured: ${redact(e.message).slice(0, 200)}`
      for (const k of ['a', 'b', 'e']) if (!cases[k].why) cases[k].why = why
    }

    if (a && b && control) {
      // (a) The cap allows a swap inside it. Exact amounts are NOT asserted: the fork copies a pool
      // on first touch and our own swaps move that copy, which Jupiter's live quote never sees, so
      // received drifts below quoted by more the longer a fork runs. Measured at -0.02% to -0.14%
      // on a fresh one. What is asserted is the tolerance and that the wallet's input fell by
      // exactly what was sent, which held on every run.
      const floor = (q) => (q * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n
      const received = a.after.usdc - a.before.usdc
      const spent = a.before.wsol - a.after.wsol
      const aOk = a.landed && spent === 100_000_000n && received >= floor(a.quoted)
      cases.a.status = aOk ? 'pass' : 'fail'
      cases.a.why = a.landed
        ? `0.1 wSOL through ${a.route}: the wallet paid exactly ${spent} base units and received ` +
          `${received} USDC against a quote of ${a.quoted}, which is ${received >= floor(a.quoted) ? 'inside' : 'OUTSIDE'} ` +
          `${SLIPPAGE_BPS} bps. Allowance ${a.before.spend?.spendLimit} to ${a.after.spend?.spendLimit}`
        : `refused by ${a.by ?? 'an unnamed program'}, so the cap was never reached: ${a.answer}`

      // (b) The same route at an amount the allowance cannot cover. A refusal only counts when
      // Swig is the one refusing: Jupiter refusing for slippage looks identical from outside.
      const bBySwig = !b.landed && (b.by ?? '').startsWith('swig')
      const bMoved = b.after.wsol !== b.before.wsol
      cases.b.status = b.landed || bMoved ? 'fail' : bBySwig ? 'pass' : 'not run'
      cases.b.why = b.landed
        ? `0.45 wSOL was authorised with ${b.before.spend?.spendLimit} base units left in the window`
        : bBySwig
          ? `0.45 wSOL with ${b.before.spend?.spendLimit} left: refused by the Swig program, ` +
            `balances unchanged (${b.before.wsol} to ${b.after.wsol}). Log lines: ${b.logs?.join(' | ')}`
          : `refused by ${b.by ?? 'an unnamed program'} rather than by Swig, so it says nothing ` +
            `about the cap: ${b.answer}`

      // The control. Without it, (b) could have been refused by anything about that route, and a
      // smaller amount through the same venue moments later is what rules that out.
      const sameWindow =
        a.before.spend?.lastReset !== undefined &&
        String(a.after.spend?.lastReset) === String(control.before.spend?.lastReset)
      cases.b.why +=
        `. Control: 0.35 wSOL through the same venue ` +
        `${control.landed ? 'landed straight after' : `did NOT land (${control.answer}), so (b) is not attributable to the cap`}` +
        `, and (a), (b) and the control ${sameWindow ? 'all fell inside one window' : 'DID NOT all fall inside one window, so the control drew on a fresh allowance and proves less than it appears to'}`
      if (!control.landed || !sameWindow) cases.b.status = 'not run'

      // (e) The allowance comes back, and the acceptance asks at which slot. Windows are aligned to
      // the slot clock rather than to the role: lastReset is floor(slot / window) * window, and it
      // is only rewritten when a spend lands, so reading the remaining field between windows shows
      // a stale number.
      //
      // Through a second pool that nothing earlier in this run touched. The fork copies a pool on
      // first touch and every swap above moved Raydium's copy away from the live quote, so a probe
      // there came back refused by Raydium, which says nothing about the window. A refused probe
      // changes no state, so the first probe cannot move this pool for the second.
      const spend = await spendNow()
      const lastReset = BigInt(spend?.lastReset ?? 0)
      const boundary = lastReset + BigInt(WINDOW)
      const probe = async (atSlot) => {
        while (BigInt(await connection.getSlot()) < atSlot)
          await new Promise((r) => setTimeout(r, 400))
        const sim = await agentSwap(450_000_000n, PROBE_VENUE)
        return sim
      }
      const before = await probe(boundary)
      const after = await probe(boundary + 1n)
      // A Jupiter refusal is not an answer about the window, it is the fork's copy of the pool
      // having drifted from the live quote, and counting it either way would be the wrong-reason
      // trap that (b) and (c) already guard against. Same rule: only Swig decides.
      const eWrongReason = [before, after].some(
        (r) => !r.landed && !(r.by ?? '').startsWith('swig'),
      )
      const restored = !before.landed && after.landed
      cases.e.status = eWrongReason ? 'not run' : restored ? 'pass' : 'fail'
      cases.e.why = eWrongReason
        ? `the boundary probe was answered by ${[before, after].find((r) => !r.landed && !(r.by ?? '').startsWith('swig'))?.by ?? 'an unnamed program'} rather than by Swig ` +
          `(${[before, after].find((r) => !r.landed && !(r.by ?? '').startsWith('swig'))?.answer}), ` +
          `so it says nothing about the window. The fork copies a pool on first touch and our own ` +
          `swaps move that copy, which Jupiter's live quote never sees, so a probe late in a run ` +
          `drifts out of tolerance. A spike that asserts this clause needs a fresh pool per probe`
        : restored
          ? `lastReset read ${lastReset} and window ${WINDOW}. A 0.45 wSOL swap was refused at ` +
            `slot ${boundary} and landed from ${boundary + 1n}, so the allowance returns when ` +
            `slot - lastReset is greater than the window, not at it. The remaining field still read ` +
            `${before.before.spend?.spendLimit} before it landed, which is the stale number a screen ` +
            `must not show raw`
          : `not restored as the acceptance states: at slot ${boundary} the swap ` +
            `${before.landed ? 'landed when it should have been refused' : `was refused (${before.by ?? 'unnamed'})`} ` +
            `and at ${boundary + 1n} it ` +
            `${after.landed ? 'landed' : `was refused by ${after.by ?? 'an unnamed program'}: ${after.answer}`}`
    }
  }

  // (f) Root removes the role, and the same instruction as (c) is tried again. A refusal only
  // means something here if (c) could have succeeded, so this states the dependency rather than
  // quietly counting a second refusal as proof.
  const removeIxs = await swig.getRemoveAuthorityInstructions(
    swigAccount,
    rootRole.id,
    agentRole.id,
  )
  const removed = await send(removeIxs, [payer])
  if (!removed.landed) {
    cases.f.why = `root could not remove the role, so the after state was never reached: ${removed.answer}`
    return
  }
  const after = await swig.fetchSwig(connection, swigAddress)
  const stillThere = after.roles.some((r) => r.id === agentRole.id)
  const fAgain = await send(cSigned, [payer, agent])
  cases.f.status = !stillThere && !fAgain.landed ? 'pass' : 'fail'
  cases.f.why = stillThere
    ? 'root removed the role and it still reads back on the account'
    : fAgain.landed
      ? `the agent transacted after its role was removed, signature ${fAgain.answer}`
      : `the role is gone from the account and the next agent transaction was refused: ${fAgain.answer}`
}

const ran = Object.values(cases).filter((c) => c.status === 'pass').length
const pass = ran === 7

const measured =
  `${ran} of 7 cases exercised on ${CHAIN} at slot ${slot}. ` +
  (jupiterMissing
    ? `The pinned Jupiter id is not a program on devnet: executable ${jupiterProgram.executable}, ` +
      `owned by ${jupiterProgram.owner}, ${jupiterProgram.bytes} bytes, against executable true and ` +
      '36 bytes under the BPF upgradeable loader on mainnet. An agent role scoped to ' +
      'programLimit(Jupiter) therefore scopes to something that cannot execute on devnet, so the 7 ' +
      'cases cannot be exercised there however well funded the payer is. '
    : `The pinned Jupiter id is a program on ${CHAIN}. `) +
  `The Swig program is live (executable ${swigProgram.executable}, owner ${swigProgram.owner}), ` +
  'the agent role builds and passes assertAgentRoleShape, and the first of the 7 transactions ' +
  `reaches ${CHAIN} and is answered "${firstTransactionAnswer}", so nothing in our code is the ` +
  `blocker. Separately the payer holds ${balance} lamports against the ${requiredLamports} the 7 ` +
  'cases need.'

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const result = {
  id: 'F5',
  pass,
  measured,
  date: new Date().toISOString().slice(0, 10),
  commit,
  slot,
  rpc: rpcOrigin,
  keySource,
  devnet: { swigProgram, jupiterProgram },
  funding: {
    requiredLamports,
    rentForTwoRoleSwig: rentForTwoRoles,
    lamportsPerSignature: LAMPORTS_PER_SIGNATURE,
    transactionsInTheSevenCases: TRANSACTIONS_IN_THE_SEVEN_CASES,
    balanceLamports: balance,
    faucetAttempts,
  },
  firstTransaction: {
    instruction: 'createSwig, the first of the seven cases',
    bytes: createTx.serialize().length,
    swigAddress: String(swigAddress),
    answer: firstTransactionAnswer,
  },
  cases,
  blockedBy: funded ? ['OP-20'] : jupiterMissing ? ['OP-19', 'OP-20'] : ['OP-19'],
  notes:
    'No case was exercised, so nothing here says the cap holds or that it does not. Two blockers. ' +
    'OP-20 is the one that matters: the pinned Jupiter id is not a program on devnet, so the 7 ' +
    'cases are not reachable there at any funding level, and a live-arming demo on devnet cannot ' +
    'show the cap stopping a swap. A Surfpool mainnet fork carries the real Jupiter program and ' +
    'the real Swig program, costs nothing and needs no mainnet funds, and F9 already showed a ' +
    'committed Surfpool snapshot replays offline with no key. OP-19 is the smaller one, lamports.',
}

writeFileSync(`${here}result.json`, `${JSON.stringify(result, null, 2)}\n`)
console.log(`F5: ${pass ? 'pass' : 'FAIL'}, ${measured}`)
console.log(`F5: blocked by ${result.blockedBy.join(' and ')}. Wrote spikes/F5/result.json.`)
