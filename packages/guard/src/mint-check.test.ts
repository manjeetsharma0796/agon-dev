import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { Reason } from '@agon/core'
import { checkMints, RULE_VERSION } from './mint-check.js'

// The 30 mints T-C02 recorded, read back in replay. Real mainnet accounts, not invented ones: a
// mint check written against mints somebody made up is a mint check tested on the shapes its
// author already thought of.
const FIXTURE = 'fixtures/recorded/rpc/799727ca03b92b4e.json'
const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  request: { body: { params: [string[], unknown] } }
  response: { body: { result: { value: unknown[]; context: { slot: number } } } }
}
const MINTS = recorded.request.body.params[0]
const SLOT = recorded.response.body.result.context.slot

// Same guard as net.test.ts: the offline suite must not reach the network, and must not depend on
// a key being present.
const saved = new Map<string, string | undefined>()
let realFetch: typeof globalThis.fetch
beforeEach(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('the offline suite reached the network')
  }) as typeof globalThis.fetch
  for (const key of ['HELIUS_API_KEY', 'JUPITER_API_KEY', 'JEV_API_KEY', 'RUGCHECK_TOKEN']) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
  for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
})

test('30 real mints, read in one pass', async () => {
  const checks = await checkMints(MINTS)
  expect(checks.size).toBe(30)
  const blocked = [...checks.values()].filter((c) => c.verdict === 'block')
  expect(blocked).toHaveLength(6)
  expect([...checks.values()].filter((c) => c.verdict === 'pass')).toHaveLength(24)
  for (const check of checks.values()) {
    expect(check.dataSlot, `${check.mint} was not stamped with the slot it was read at`).toBe(SLOT)
  }
})

test('every reason satisfies the frozen Reason contract', async () => {
  // The contract refuses a number without its limit and its unit. These findings are categorical,
  // so they must carry no number at all rather than an invented one.
  const checks = await checkMints(MINTS)
  for (const check of checks.values()) {
    for (const reason of check.reasons) {
      expect(() => Reason.parse(reason), `${check.mint}: ${reason.rule}`).not.toThrow()
    }
  }
})

test('a transfer hook extension with no hook set is not a transfer hook', async () => {
  // The trap. 5 of these 30 mints carry the transferHook extension with `programId: null`, which
  // means no hook is installed. Treating the extension's presence as the danger would block 5 of
  // 30 tokens, 17 percent of this sample, for something none of them does.
  const checks = await checkMints(MINTS)
  const withHookExtension = [...checks.values()].filter((c) =>
    (
      recorded.response.body.result.value as {
        data: { parsed: { info: { extensions?: { extension: string }[] } } }
      }[]
    )[MINTS.indexOf(c.mint)]?.data.parsed.info.extensions?.some(
      (e) => e.extension === 'transferHook',
    ),
  )
  expect(withHookExtension).toHaveLength(5)
  for (const check of withHookExtension) {
    expect(
      check.facts?.transferHookProgram,
      `${check.mint} reported a hook that is not set`,
    ).toBeNull()
    expect(check.reasons.map((r) => r.rule)).not.toContain('mint-transfer-hook')
  }
})

test('freeze authority and a permanent delegate each block, and say who holds them', async () => {
  const checks = await checkMints(MINTS)
  const freeze = [...checks.values()].filter(
    (c) => c.facts?.freezeAuthority !== null && c.facts !== null,
  )
  const delegate = [...checks.values()].filter((c) => c.facts?.permanentDelegate != null)
  expect(freeze).toHaveLength(6)
  expect(delegate).toHaveLength(4)
  for (const check of [...freeze, ...delegate]) {
    expect(check.verdict).toBe('block')
    const rules = check.reasons.map((r) => r.rule)
    expect(
      rules.some((r) => r === 'mint-freeze-authority' || r === 'mint-permanent-delegate'),
    ).toBe(true)
  }
  const one = freeze[0]
  const reason = one?.reasons.find((r) => r.rule === 'mint-freeze-authority')
  expect(reason?.message).toContain(one?.facts?.freezeAuthority ?? 'missing')
})

test('a live mint authority is reported and does not block, because USDC has one', async () => {
  const checks = await checkMints(MINTS)
  const minted = [...checks.values()].filter((c) => c.facts?.mintAuthority != null)
  expect(minted).toHaveLength(8)
  const onlyMintAuthority = minted.filter(
    (c) => c.facts?.freezeAuthority === null && c.facts?.permanentDelegate === null,
  )
  for (const check of onlyMintAuthority) {
    expect(check.verdict, `${check.mint} was blocked for a mint authority alone`).toBe('pass')
    expect(check.reasons.map((r) => r.rule)).toContain('mint-authority-live')
  }
})

test('a transfer fee is reported as a percentage the user can read', async () => {
  const checks = await checkMints(MINTS)
  const fees = [...checks.values()].filter((c) => (c.facts?.transferFeeBps ?? 0) > 0)
  expect(fees).toHaveLength(10)
  const reason = fees[0]?.reasons.find((r) => r.rule === 'mint-transfer-fee')
  expect(reason?.message).toMatch(/\d+\.\d\d% on every transfer/)
})

test('an unreadable chain blocks every mint asked about, in the words T-C04 fixes', async () => {
  // Replay with no fixture is how "unreachable" arrives in the offline suite: the wrapper throws.
  const checks = await checkMints(['So11111111111111111111111111111111111111112'])
  const check = checks.get('So11111111111111111111111111111111111111112')
  expect(check?.verdict).toBe('block')
  expect(check?.reasons[0]?.message).toContain("Couldn't verify this token. Not safe to proceed.")
  expect(check?.dataSlot, 'a verdict with no data must not claim a slot').toBeNull()
  expect(check?.facts).toBeNull()
})

test('nothing is returned for a mint that was never asked about', async () => {
  expect((await checkMints([])).size).toBe(0)
})

test('a non-200 and a JSON-RPC error both fail closed, and each says which', async () => {
  const at = async (status: number, body: unknown) => ({
    status,
    body,
    ms: 1,
    attempts: 1,
    slot: null,
    fromFixture: false,
  })
  const five = await checkMints(['mint-a'], { net: () => at(503, {}) })
  expect(five.get('mint-a')?.verdict).toBe('block')
  expect(five.get('mint-a')?.reasons[0]?.message).toContain('answered 503')

  const rpcError = await checkMints(['mint-a'], {
    net: () => at(200, { error: { message: 'Node is behind' } }),
  })
  expect(rpcError.get('mint-a')?.verdict).toBe('block')
  expect(rpcError.get('mint-a')?.reasons[0]?.message).toContain('Node is behind')

  const nonsense = await checkMints(['mint-a'], {
    net: () => at(200, { result: { value: 'not a list' } }),
  })
  expect(nonsense.get('mint-a')?.verdict).toBe('block')
  expect(nonsense.get('mint-a')?.reasons[0]?.message).toContain('not an account list')
})

test('a short account list fails closed rather than misaligning mints and answers', async () => {
  // getMultipleAccounts answers positionally. A list of the wrong length would silently pair mint
  // 2's answer with mint 3, so the verdict would be about a token nobody asked about.
  const short = await checkMints(['mint-a', 'mint-b'], {
    net: async () => ({
      status: 200,
      body: { result: { value: [null], context: { slot: 1 } } },
      ms: 1,
      attempts: 1,
      slot: 1,
      fromFixture: false,
    }),
  })
  expect([...short.values()].every((c) => c.verdict === 'block')).toBe(true)
})

test('every verdict is stamped with the rules that produced it', async () => {
  const checks = await checkMints(MINTS)
  for (const check of checks.values()) expect(check.ruleVersion).toBe(RULE_VERSION)
  // Including the one that read nothing at all: a block still has to say which rules blocked it.
  const unread = await checkMints(['So11111111111111111111111111111111111111112'])
  expect([...unread.values()][0]?.ruleVersion).toBe(RULE_VERSION)
})
