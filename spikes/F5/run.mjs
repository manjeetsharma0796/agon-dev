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
const FAUCETS = [
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

const redact = (s) => (heliusKey ? String(s).split(heliusKey).join('<api key>') : String(s))

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
  } catch (e) {
    throw new Error(
      `DEVNET_KEYPAIR is neither a 64-number json array nor a path to one: ${e.message}. ` +
        'Write it the way solana-keygen does, and keep it out of the repo.',
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
}

const ran = Object.values(cases).filter((c) => c.status === 'pass').length
const pass = ran === 7

const measured =
  `${ran} of 7 cases exercised on devnet at slot ${slot}. ` +
  `The Swig program is live there (executable ${swigProgram.executable}, owner ${swigProgram.owner}), ` +
  `the agent role builds and passes assertAgentRoleShape, and the first of the seven transactions ` +
  `reaches devnet and is answered "${firstTransactionAnswer}". ` +
  `The payer holds ${balance} lamports against the ${requiredLamports} the seven cases need. ` +
  `The pinned Jupiter id is ${jupiterProgram.executable ? 'a program on devnet' : `not a program on devnet, it is a ${jupiterProgram.bytes}-byte account owned by ${jupiterProgram.owner}`}.`

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
  rpc: RPC,
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
    'No case was exercised, so nothing here says the cap holds or that it does not. Two blockers, ' +
    'one for a person each: OP-19 funds a devnet key, OP-20 is the CP1 decision about cases (a), ' +
    '(b) and (e), which cannot run on devnet while the pinned Jupiter id is not a program there.',
}

writeFileSync(`${here}result.json`, `${JSON.stringify(result, null, 2)}\n`)
console.log(`F5: ${pass ? 'pass' : 'FAIL'}, ${measured}`)
console.log(`F5: blocked by ${result.blockedBy.join(' and ')}. Wrote spikes/F5/result.json.`)
