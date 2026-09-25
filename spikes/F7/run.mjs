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

// 1 of the 4 acceptance clauses can run without a chain. Reporting that as a pass would turn a
// quarter of a spike into a green row.
const result = {
  id: 'F7',
  pass: false,
  measured:
    `clause 1 of 4 answered: Swig has a native expiry, ${checks.length} of ${checks.length - failed.length} ` +
    `SDK checks as expected. Clauses 2 to 4 need a transaction to land on devnet and there is no ` +
    `funded key, so 0 runs happened and manageAuthority was observed in 0 of 0`,
  date: new Date().toISOString().slice(0, 10),
  commit,
  nativeExpiryExists,
  versions: { classic: classic.version, lib: lib.version, coder: coder.version },
  checks: checks.map((c) => ({ question: c.q, answer: c.a, asExpected: c.a === c.expect })),
  clauses: {
    'native expiry field checked and recorded': 'done',
    'pre-signed removal lands after expiry, next agent transaction fails':
      'not run, no funded devnet key',
    'earlier manual revoke leaves the pre-signed transaction harmless':
      'not run, no funded devnet key',
    'agent key held manageAuthority in 0 of the runs': 'not run, 0 runs',
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
