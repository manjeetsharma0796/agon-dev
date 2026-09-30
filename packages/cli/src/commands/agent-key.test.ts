import bs58 from 'bs58'
import { afterAll, expect, test, vi } from 'vitest'
import { agentKey, keychainEntry } from '../daemon/keystore.js'
import { runAgentKey } from './agent-key.js'

// The real OS keychain under a test-only service name, as keystore.test.ts does, so a test never
// touches the real key. CI's Linux runner has no Secret Service: there the keychain tests skip and
// say why, and the failure test runs against the real "cannot reach the keychain" error instead.
const SERVICE = `agon-test-cli-${process.pid}`
const reachable = (() => {
  try {
    keychainEntry(SERVICE, 'probe').getSecret()
    return true
  } catch {
    return false
  }
})()
const why = 'no OS keychain reachable here (CI Linux has no Secret Service)'

afterAll(() => {
  if (reachable) keychainEntry(SERVICE, 'agent-key').deleteCredential()
})

/** Runs the command and captures everything it could print: its 2 streams and the console. */
function run() {
  const out: string[] = []
  const err: string[] = []
  const logged: string[] = []
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi
      .spyOn(console, m)
      .mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' '))),
  )
  // The process streams too, so a direct write that skips the injected writers is still seen.
  const streams = [process.stdout, process.stderr].map((stream) =>
    vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      logged.push(String(chunk))
      return true
    }),
  )
  const code = runAgentKey(
    (s) => void out.push(s),
    (s) => void err.push(s),
    SERVICE,
  )
  ;[...spies, ...streams].forEach((s) => s.mockRestore())
  return { code, out: out.join(''), err: err.join(''), logged: logged.join('\n') }
}

test.skipIf(!reachable)(
  `prints exactly 1 line, a 32-byte base58 public key, the same twice`,
  () => {
    const first = run()
    const again = run()
    expect(first.code).toBe(0)
    expect(first.out).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}\n$/)
    expect(bs58.decode(first.out.trim()).length).toBe(32)
    expect(again.out).toBe(first.out)
    expect(first.err + first.logged).toBe('')
  },
)

test.skipIf(!reachable)('the printed key is the keychain key', () => {
  expect(run().out.trim()).toBe(agentKey(SERVICE).publicKey.toBase58())
})

test.skipIf(!reachable)('the secret appears in no output, in any encoding', () => {
  // Both paths: made fresh, then read back.
  keychainEntry(SERVICE, 'agent-key').deleteCredential()
  const made = run()
  const read = run()
  const secret = agentKey(SERVICE).secretKey
  const everything = [made, read].map((r) => r.out + r.err + r.logged).join('\n')
  const forms = [
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('hex'),
    bs58.encode(Buffer.from(secret)),
    secret.join(','),
  ]
  for (const form of forms) expect(everything).not.toContain(form)
})

test.skipIf(!reachable)(
  'a bad keychain entry exits non-zero naming the cause and the next step',
  () => {
    keychainEntry(SERVICE, 'agent-key').setSecret(new Uint8Array(10))
    const r = run()
    keychainEntry(SERVICE, 'agent-key').deleteCredential()
    expect(r.code).not.toBe(0)
    expect(r.out).toBe('')
    expect(r.err).toContain('10 bytes where 64 were expected')
    expect(r.err).toMatch(/Delete .* and run again/)
  },
)

test.skipIf(reachable)(
  `an unreachable keychain exits non-zero naming the cause and the next step (${why})`,
  () => {
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/OS keychain/)
    expect(r.err).toMatch(/run `agon agent-key` again/)
  },
)
