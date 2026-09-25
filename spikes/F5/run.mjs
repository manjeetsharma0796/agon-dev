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
  const notWritten = 'the case body is not written yet, and the platform is no longer the blocker'
  await runAuthorisationCases()
  for (const k of ['a', 'b', 'e']) {
    cases[k].status = 'not run'
    cases[k].why =
      `${notWritten}. This one also needs a real Jupiter swap that moves the capped mint, because ` +
      `the recurring limit is applied by comparing balances after the inner instructions run`
  }
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
      return { landed: true, answer: await connection.sendTransaction(tx) }
    } catch (e) {
      return { landed: false, answer: redact(e.message).replace(/\s+/g, ' ').trim().slice(0, 300) }
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
  // A refusal only counts when it is the refusal this case is about. "missing required signature"
  // is the system program objecting to the transfer itself, and reading that as the program limit
  // holding is how a spike reports a pass it did not earn.
  const wrongReason = /missing required signature|insufficient (lamports|funds)/i.test(c.answer)
  cases.c.status = c.landed ? 'fail' : wrongReason ? 'not run' : 'pass'
  cases.c.why = c.landed
    ? `the transfer to ${stranger.toBase58()} was authorised, signature ${c.answer}. The role is not holding`
    : wrongReason
      ? `refused, but for the wrong reason, so this is not evidence either way: ${c.answer}`
      : `refused: ${c.answer}`

  // (d) A call to a program that is not Jupiter. The memo program is used because it is harmless
  // and always present, so a refusal here is the program limit and not a missing account.
  const memoIx = new web3.TransactionInstruction({
    keys: [],
    programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    data: Buffer.from('agon f5 case d'),
  })
  const dSigned = await swig.getSignInstructions(swigAccount, agentRole.id, [memoIx])
  const d = await send(dSigned, [payer, agent])
  // What this measured, rather than what it first looked like. (c) sends value through a non
  // Jupiter program and Swig refuses it with its own error. (d) sends a memo, which carries no
  // accounts and moves nothing, and Swig allows it. Together those say the program limit gates
  // value movement rather than every CPI, which is a coherent design and not a hole. It is also
  // not what this row's acceptance says, and that wording is a CP1 question rather than something
  // a spike settles for itself, so the case records the observation and fails rather than being
  // quietly reworded into a pass.
  cases.d.status = d.landed ? 'fail' : 'pass'
  cases.d.why = d.landed
    ? `a memo instruction, which carries 0 accounts and moves nothing, was authorised under a role ` +
      `whose only program permission is Jupiter: signature ${d.answer}. Read with (c), where a ` +
      `system transfer through the same role was refused by Swig itself with custom program error ` +
      `0xbbe, this says the program limit gates value movement and not every CPI. The acceptance ` +
      `clause says "a call to a non-Jupiter program is rejected" without qualification, so either ` +
      `the clause wants narrowing to calls that move value, or the role wants an action that ` +
      `refuses all of them. That is a CP1 decision and not a spike's to make`
    : `refused: ${d.answer}`

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
