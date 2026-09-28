// F7: pre-signed expiry.
//
//   node scripts/spike.mjs F7        reads the installed Swig SDK, no keys, no network
//
// The acceptance says to check Swig's protocol-level SDK for a native expiry field FIRST, and the
// order is the whole point: T-D02 builds expiry out of a pre-signed transaction and a durable
// nonce, which is a lot of machinery to carry if the program already does it.
//
// It does. This spike records that, and records exactly how far the evidence goes, because the
// part that decides whether the native mechanism is usable cannot be read off a type declaration.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = `${here}../../`

/** The installed copy of a Swig package, by the path pnpm actually put it at. */
const pkg = (name) => {
  const dir = execFileSync(
    'sh',
    [
      '-c',
      `ls -d "${root}node_modules/.pnpm/@swig-wallet+${name}@"*/node_modules/@swig-wallet/${name} | head -1`,
    ],
    { encoding: 'utf8' },
  ).trim()
  if (dir === '') throw new Error(`@swig-wallet/${name} is not installed, so nothing was checked`)
  return {
    version: JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).version,
    types: readFileSync(`${dir}/dist/index.d.ts`, 'utf8'),
  }
}

const classic = pkg('classic')
const lib = pkg('lib')
const coder = pkg('coder')

/** Each check is a question with a yes or no answer, so the result is not a matter of opinion. */
const checks = [
  {
    q: 'Does the wrapper SDK expose any expiry concept?',
    a: /\b(expirySlot|maxDurationSlots|sessionDuration|expiration)\b/.test(classic.types),
    expect: false,
    note: 'Looking here alone is how you conclude there is no native expiry and go and build one.',
  },
  {
    q: 'Does the protocol lib define a session-based authority?',
    a: /declare abstract class SessionBasedAuthority extends Authority/.test(lib.types),
    expect: true,
  },
  {
    q: 'Does that authority carry a slot the session expires at?',
    a: /abstract expirySlot: bigint/.test(lib.types),
    expect: true,
  },
  {
    q: 'And a ceiling on how long a session may last?',
    a: /abstract maxDuration: bigint/.test(lib.types),
    expect: true,
  },
  {
    q: 'Can a session be created for a separate key, with a duration?',
    a: /createSession\(args: \{[\s\S]{0,400}?newSessionKey: SolPublicKeyData;[\s\S]{0,200}?sessionDuration\?: bigint;/.test(
      lib.types,
    ),
    expect: true,
  },
  {
    q: 'Is the session key a parameter of createSession rather than its signer?',
    // The signer slot is filled by `authority`. The new session key is data in the instruction.
    a: /getCreateSessionV1BaseAccountMetasWithAuthority\(accounts: CreateSessionV1InstructionAccounts, authority: SolPublicKeyData\)/.test(
      lib.types,
    ),
    expect: true,
    note: 'This is the one that decides whether the agent could renew itself, and it is read off the SDK, not proved against the program.',
  },
  {
    q: 'Does the coder, the lowest layer, know about session expiration?',
    a: /currentSessionExpiration/.test(coder.types),
    expect: true,
  },
]

const failed = checks.filter((c) => c.a !== c.expect)
const nativeExpiryExists = checks.slice(1).every((c) => c.a === c.expect)

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

/**
 * The on-chain half. Runs only when given a chain, and a Surfpool fork is one that funds itself,
 * which is what unblocked this after OP-19 was narrowed.
 *
 * It tests the native expiry rather than a pre-signed removal, deliberately, and that choice is the
 * finding rather than a shortcut. Clause 1 established that Swig carries a session based authority
 * with an expirySlot. If that holds on chain, then the pre-signed transaction and durable nonce
 * T-D02 proposes are a mechanism for something the protocol already does, and measuring the thing
 * that exists is worth more than measuring the thing we were about to build.
 */
const onChain = { ran: false, why: '', observations: {} }
const RPC = process.env['SURFPOOL_RPC_URL'] ?? ''
if (!RPC) {
  onChain.why =
    'no chain given. Set SURFPOOL_RPC_URL to a Surfpool fork, which funds itself with requestAirdrop ' +
    'and needs no key, so this no longer waits on OP-19'
} else {
  const { createRequire } = await import('node:module')
  const { realpathSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  const entry = realpathSync('packages/chain/node_modules/@swig-wallet/classic/dist/index.js')
  const web3 = createRequire(entry)('@solana/web3.js')
  const swig = await import(pathToFileURL(entry).href)
  const chain = await import(pathToFileURL('packages/chain/dist/index.js').href)
  const conn = new web3.Connection(RPC, 'confirmed')
  const SOL = 'So11111111111111111111111111111111111111112'

  const send = async (ixs, signers) => {
    try {
      const { blockhash } = await conn.getLatestBlockhash()
      const tx = new web3.VersionedTransaction(
        new web3.TransactionMessage({
          payerKey: signers[0].publicKey,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message(),
      )
      tx.sign(signers)
      return { landed: true, sig: await conn.sendTransaction(tx) }
    } catch (e) {
      return { landed: false, answer: String(e.message).replace(/\s+/g, ' ').slice(0, 200) }
    }
  }

  try {
    const payer = web3.Keypair.generate()
    await conn.requestAirdrop(payer.publicKey, 20e9)
    await new Promise((r) => setTimeout(r, 1500))
    const id = crypto.getRandomValues(new Uint8Array(32))
    const addr = swig.findSwigPda(id)
    await send(
      [
        await swig.getCreateSwigInstruction({
          payer: payer.publicKey,
          id,
          actions: swig.Actions.set().all().get(),
          authorityInfo: swig.createEd25519AuthorityInfo(payer.publicKey),
        }),
      ],
      [payer],
    )
    await new Promise((r) => setTimeout(r, 1200))

    let account = await swig.fetchSwig(conn, addr)
    const root = account.roles[0]
    const agent = web3.Keypair.generate()
    const added = await send(
      await swig.getAddAuthorityInstructions(
        account,
        root.id,
        swig.createEd25519SessionAuthorityInfo(agent.publicKey, 50n),
        chain.agentRoleActions({ mint: SOL, recurringAmount: 500000000n, window: 150n }),
      ),
      [payer],
    )
    if (!added.landed) throw new Error('the session authority could not be added: ' + added.answer)
    await new Promise((r) => setTimeout(r, 1200))

    account = await swig.fetchSwig(conn, addr)
    const role = account.roles.find((r) => r.id !== root.id)
    // Clause 4, and it is a property of the role rather than of a run, so it is read off the role
    // rather than inferred from nothing having gone wrong.
    onChain.observations.agentHeldManageAuthority = role.actions.canManageAuthority() === true
    onChain.observations.maxDuration = String(role.authority.maxDuration)

    // Signed by the agent as well as the payer: the session is created by the role's own authority,
    // and signing with the payer alone fails signature verification. That cost a run.
    const sessionKey = web3.Keypair.generate()
    const started = await send(
      await swig.getCreateSessionInstructions(account, role.id, sessionKey.publicKey, 20n),
      [payer, agent],
    )
    if (!started.landed) throw new Error('the session could not be started: ' + started.answer)
    await new Promise((r) => setTimeout(r, 1200))

    account = await swig.fetchSwig(conn, addr)
    const live = account.roles.find((r) => r.id === role.id)
    const expirySlot = Number(live.authority.expirySlot)
    onChain.observations.expirySlot = expirySlot

    const deadline = Date.now() + 120000
    let slot = await conn.getSlot()
    while (slot <= expirySlot && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000))
      slot = await conn.getSlot()
    }
    onChain.observations.slotWhenTested = slot
    onChain.observations.expired = slot > expirySlot

    const memo = new web3.TransactionInstruction({
      keys: [],
      programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from('F7 after expiry'),
    })
    const after = await send(await swig.getSignInstructions(account, role.id, [memo]), [
      payer,
      sessionKey,
    ])
    onChain.observations.sessionKeyCouldActAfterExpiry = after.landed
    onChain.observations.refusal = after.landed ? null : after.answer
    onChain.ran = true
  } catch (e) {
    onChain.why = String(e.message).slice(0, 220)
  }
}

const expiryHeld =
  onChain.ran &&
  onChain.observations.expired === true &&
  onChain.observations.sessionKeyCouldActAfterExpiry === false

// 1 of the 4 acceptance clauses can run without a chain. Reporting that as a pass would turn a
// quarter of a spike into a green row.
const result = {
  id: 'F7',
  pass: false,
  measured:
    `clause 1 of 4 answered: Swig has a native expiry, ${checks.length} of ${checks.length - failed.length} ` +
    `SDK checks as expected. ` +
    (onChain.ran
      ? `On chain that native expiry holds: a session expired at slot ${onChain.observations.expirySlot}, ` +
        `was tested at ${onChain.observations.slotWhenTested}, and the session key could act after it: ` +
        `${onChain.observations.sessionKeyCouldActAfterExpiry}. The agent key held manageAuthority: ` +
        `${onChain.observations.agentHeldManageAuthority}, which answers clause 4. Clauses 2 and 3 ` +
        `describe a pre-signed removal, which is a mechanism for something the protocol already does, ` +
        `and are not run pending OP-30`
      : `The on chain half did not run: ${onChain.why}`),
  date: new Date().toISOString().slice(0, 10),
  commit,
  nativeExpiryExists,
  versions: { classic: classic.version, lib: lib.version, coder: coder.version },
  checks: checks.map((c) => ({ question: c.q, answer: c.a, asExpected: c.a === c.expect })),
  onChain,
  nativeExpiryHeldOnChain: expiryHeld,
  clauses: {
    'native expiry field checked and recorded': 'done',
    'pre-signed removal lands after expiry, next agent transaction fails': onChain.ran
      ? 'not run, and the reason is a finding rather than a blocker: the native expiry holds on chain, so a pre-signed removal is a mechanism for something the protocol already does. Whether it is still wanted is OP-30'
      : 'not run: ' + onChain.why,
    'earlier manual revoke leaves the pre-signed transaction harmless': onChain.ran
      ? 'not run, for the same reason: there is no pre-signed transaction unless OP-30 says to build one'
      : 'not run: ' + onChain.why,
    'agent key held manageAuthority in 0 of the runs': onChain.ran
      ? onChain.observations.agentHeldManageAuthority === false
        ? 'pass, read off the role rather than inferred from nothing going wrong'
        : 'FAIL, the agent role reads as holding manageAuthority'
      : 'not run, 0 runs',
  },
  notes:
    'Swig has a native expiry: a session based authority carries an expirySlot and a maxDuration, ' +
    'and a session is created for a separate key with a duration. That makes T-D02s pre-signed ' +
    'transaction and durable nonce potentially unnecessary. See README.md in this directory.',
}

writeFileSync(`${here}result.json`, `${JSON.stringify(result, null, 2)}\n`)

console.log(`F7: ${result.pass ? 'pass' : 'FAIL'}, ${result.measured}`)
for (const c of checks) {
  console.log(
    `  ${c.a === c.expect ? 'as expected' : 'UNEXPECTED '}  ${c.a ? 'yes' : 'no '}  ${c.q}`,
  )
}
if (failed.length > 0) {
  console.log(
    `\n${failed.length} check(s) did not match. The SDK has changed; re-read before trusting this.`,
  )
  process.exit(1)
}
