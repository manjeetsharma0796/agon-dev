import { Entry } from '@napi-rs/keyring'
import { afterAll, expect, test, vi } from 'vitest'
import { agentKey } from './keystore.js'

// A real OS keychain, under a service name of its own so a test never touches the real key. CI's
// Linux runner has no Secret Service to talk to, so there the store cannot be reached and this says
// so rather than faking one: a keychain test against a fake keychain measures the fake.
const SERVICE = `agon-test-${process.pid}`
const reachable = (() => {
  try {
    new Entry(SERVICE, 'probe').getSecret()
    return true
  } catch {
    return false
  }
})()

afterAll(() => {
  if (reachable) new Entry(SERVICE, 'agent-key').deleteCredential()
})

test.skipIf(!reachable)(
  'the agent key is made once in the OS keychain and read back the same',
  () => {
    const first = agentKey(SERVICE)
    const again = agentKey(SERVICE)
    expect(again.publicKey.toBase58()).toBe(first.publicKey.toBase58())
  },
)

test.skipIf(!reachable)('the key never reaches a log, in any of its encodings', () => {
  const lines: string[] = []
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi
      .spyOn(console, m)
      .mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' '))),
  )
  // Both paths: made fresh, then read back. Without the delete, the first test's key is already
  // there and the path that creates one is never watched.
  new Entry(SERVICE, 'agent-key').deleteCredential()
  const key = agentKey(SERVICE)
  agentKey(SERVICE)
  spies.forEach((s) => s.mockRestore())
  const secret = key.secretKey
  const forms = [
    Buffer.from(secret).toString('base64'),
    Buffer.from(secret).toString('hex'),
    secret.join(','),
  ]
  for (const form of forms) expect(lines.join('\n')).not.toContain(form)
})
