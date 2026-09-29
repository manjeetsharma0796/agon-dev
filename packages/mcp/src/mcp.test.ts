import { expect, test } from 'vitest'
import { TOOLS } from '@agon/core'
import { FIXTURE_NOTE, reportRoute } from '@agon/web'
import { callAsTool, callTool, isTool } from './index.js'
import { chainMismatch } from './io.js'
import { textOf, withChain } from './test-support.js'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

/** The wallet T-C09 recorded a real page of history for. Replayed, so this needs no key. */
const RECORDED = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** A chain that holds no vault for the wallet: list_rules answers [] and reads nothing else. */
const NO_VAULT = withChain({ vault: null, rules: [] })

// What an agent may send arm_rule: whose vault, and no cap.
const SPEC = {
  wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  mints: ['So11111111111111111111111111111111111111112'],
  triggerType: 'stop',
  expiresAt: null,
}

// This lives here and not beside the routes because mcp depends on web, so a test on the web side
// that imports mcp closes the loop and tsc -b refuses the cycle on a clean build. It only showed
// up on the stripped tree, which is the kind of thing T-E03 exists to find on day 2.

test('get_report gives the agent and the web app the same answer, because it is one function', async () => {
  // Compared without the fixture marker, because the marker is not part of the answer and cannot
  // be. `Report` is a plain `z.object`, so zod strips any key the contract does not declare: a note
  // added inside `report()` is silently discarded by `Report.parse`. Each surface therefore attaches
  // the shared constant itself, after parsing, and the thing that has to match across surfaces is
  // what is left when you take it off. T-E13.
  const overHttp = (await (
    await reportRoute(new Request(`https://x/api/report?wallet=${WALLET}`))
  ).json()) as Record<string, unknown>
  const { note, ...answer } = overHttp
  expect(await callTool('get_report', { wallet: WALLET })).toEqual(answer)
  // And the marker is there, so this test can never pass by both sides losing it.
  expect(note).toBe(FIXTURE_NOTE)
})

test('check_trade is the real guard now, and answers from the wallet own history', async () => {
  // No io passed, so this is the shipped path: the record and replay wrapper serves T-C09's
  // committed recording and no key is read.
  const out = (await callTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })) as { verdict: string; reasons: { rule: string; message: string }[] }

  expect(out.verdict).toBe('block')

  // The point of wiring the real guard: a refusal that names the rule and carries the number,
  // computed from this wallet's own trades rather than read out of a stored example.
  const size = out.reasons.find((r) => r.rule === 'size-vs-median')
  expect(size?.message).toMatch(/[\d.]+x your median size of [\d.]+ SOL/)
  expect(size?.message).toMatch(/Send [\d.]+ SOL or less/)
})

test('the HTTP route has not caught up, and the test says so rather than hiding it', async () => {
  // Tracked, not silent. `apps/web`'s leg still answers check_trade from fixtures/contracts, so the
  // agent and the browser now disagree on this one tool. That is a real divergence and the
  // invariant this file used to assert, "there is one answer", no longer holds for check_trade.
  // It holds for get_report above. Pointing the route at `assessTrade` is the fix and it belongs to
  // whoever owns the route, because the leg is documented as pure with 0 network calls and the real
  // path needs two reads.
  const { checkTrade: legCheckTrade } = await import('@agon/web')
  const fromLeg = legCheckTrade({ wallet: RECORDED, mint: USDC, side: 'buy', size: '2000000000' })
  const fromTool = (await callTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })) as { reasons: unknown[] }

  expect(fromLeg.reasons).not.toEqual(fromTool.reasons)
})

test('all 4 tools are reachable, and arm_rule refuses off the fork rather than answering', async () => {
  expect(TOOLS).toHaveLength(4)
  for (const name of TOOLS) expect(isTool(name)).toBe(true)
  expect(isTool('drop_table')).toBe(false)
  await expect(callTool('arm_rule', SPEC)).rejects.toThrow(/practice fork only/)
  expect(await callTool('list_rules', { wallet: WALLET }, NO_VAULT)).toEqual([])
})

test('a replayed check_trade says it was replayed, which is what nobody could see before', async () => {
  // The finding this test exists for. An outside agent called the deployed server, read USDC's
  // real freeze and mint authorities out of a check_trade verdict, confirmed those facts against
  // mainnet, and reported that the tool was reading chain state. It was replaying a recording.
  // Every number was true and the conclusion was wrong, and nothing in the payload disagreed.
  const result = await callAsTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '2000000000',
  })
  const payload = JSON.parse(textOf(result)) as { note?: string; verdict?: string }

  expect(payload.verdict).toBe('block')
  expect(payload.note, 'a replayed verdict went out with no marker on it').toBeDefined()
  expect(payload.note).toContain('recorded fixture')
})

test('the marker is per call, so one replayed answer does not brand the next', async () => {
  // A single flag shared across a server's lifetime would mark every later answer once any early
  // read hit a recording. arm_rule touches no network at all and must stay unmarked.
  const armed = await callAsTool('arm_rule', SPEC)
  expect(armed.isError).toBe(true)
  expect(textOf(armed)).not.toContain('recorded fixture')

  const rules = await callAsTool('list_rules', { wallet: WALLET }, NO_VAULT)
  expect(textOf(rules)).not.toContain('recorded fixture')
})

test('an unknown wallet is refused without handing out internal paths', async () => {
  // An outside agent asked about an unrecorded wallet and got back the fixture path the wrapper
  // wanted plus the env var that records it. That message is right in a terminal and wrong on a
  // public endpoint: it gives a stranger internals and the caller nothing it can act on.
  const result = await callAsTool('check_trade', {
    wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    mint: USDC,
    side: 'buy',
    size: '1000',
  })
  const text = textOf(result)

  expect(result.isError).toBe(true)
  expect(text, 'the fixture path reached the caller').not.toContain('fixtures/recorded')
  expect(text, 'an env var name reached the caller').not.toContain('AGON_NET_MODE')
  // Still says the cause and what to do, because a refusal with no reason is the other failure.
  expect(text).toContain('No history is available')
})

test('a size of 0 is refused, because nothing is being traded', async () => {
  // 0 parses, and then sails through: it is under any median, so the size rule never fires and the
  // answer comes back shaped like a trade that was examined.
  const result = await callAsTool('check_trade', {
    wallet: RECORDED,
    mint: USDC,
    side: 'buy',
    size: '0',
  })
  expect(result.isError).toBe(true)
  expect(textOf(result)).toContain('not a trade')
})

test('the instructions say which data source is actually in use', async () => {
  // The first version claimed check_trade "reads that wallet's last 100 transactions" and "reads
  // the mint's authorities off the chain". True with a key, false in the replay deployment, and
  // the payload note said the opposite. An agent read the instructions, believed them, and
  // reported recorded data as live. The text is derived from mode() now so it cannot drift.
  const { createServer } = await import('./index.js')
  const server = createServer()
  const instructions = (server.server as unknown as { _instructions?: string })._instructions ?? ''

  expect(instructions).toContain('REPLAY MODE')
  expect(instructions).not.toMatch(/reads the mint's authorities off the chain/)
})

test('every result names its network first, because an agent sees no banner of ours', async () => {
  // Claude Code, opencode and the rest render our data, not our page. The first key is the one
  // place we can say whether these are real funds, and unset must never read as mainnet.
  const ok = await callAsTool('list_rules', { wallet: WALLET }, NO_VAULT)
  const payload = JSON.parse(textOf(ok)) as Record<string, unknown>
  expect(Object.keys(payload)[0]).toBe('network')
  expect(payload['network']).toBe('not set, treat nothing here as real')
  // list_rules' contract is a list. Spread into an object it would come out as {"0": ...}.
  expect(payload['rules']).toEqual([])

  const refused = await callAsTool('arm_rule', SPEC)
  expect(refused.isError).toBe(true)
  expect(textOf(refused)).toMatch(/^Network: not set, treat nothing here as real\. /)
})

test('the network follows AGON_NETWORK per call', async () => {
  const before = process.env['AGON_NETWORK']
  process.env['AGON_NETWORK'] = 'fork'
  try {
    const result = await callAsTool('list_rules', { wallet: WALLET }, NO_VAULT)
    expect(JSON.parse(textOf(result)).network).toMatch(/^fork, .*no real funds$/)
  } finally {
    if (before === undefined) delete process.env['AGON_NETWORK']
    else process.env['AGON_NETWORK'] = before
  }
})

// T-C17: list_rules reads the vault from chain.
test('list_rules reports a vault rule as the chain proves it, with a null spec and a slot window', async () => {
  const vault = 'C7Bz4nps2z1NDftJUBzXQyeR2iDE5j5ztad5q1k4iA8R'
  const rules = (await callTool(
    'list_rules',
    { wallet: WALLET },
    withChain({
      vault,
      rules: [
        {
          roleId: 1,
          authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          mint: 'So11111111111111111111111111111111111111112',
          amount: 500_000_000n,
          windowSlots: 150n,
          effectiveRemaining: 500_000_000n,
          rollingWorstCase: 1_000_000_000n,
        },
      ],
    }),
  )) as Array<Record<string, unknown>>
  expect(rules).toHaveLength(1)
  expect(rules[0]).toMatchObject({
    spec: null,
    jupiterOrderId: null,
    vault,
    effectiveRemaining: '500000000',
    rollingWorstCase: '1000000000',
    swigRole: { roleId: '1', tokenRecurringLimit: { windowSlots: 150, amount: '500000000' } },
  })
})

test('with no chain configured, list_rules refuses rather than answering an empty list', async () => {
  const before = process.env['AGON_RPC_URL']
  delete process.env['AGON_RPC_URL']
  try {
    const result = await callAsTool('list_rules', { wallet: WALLET })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('No chain is configured')
    expect(textOf(result), 'an env var name reached the caller').not.toContain('AGON_RPC_URL')
  } finally {
    if (before !== undefined) process.env['AGON_RPC_URL'] = before
  }
})

test('a chain that is not the named network is refused, whatever its hostname', () => {
  const fork = { 'surfnet-version': '1.6.0', 'solana-core': '4.2.1' }
  const mainnet = { 'solana-core': '4.3.0' }
  expect(chainMismatch('fork', fork)).toBeNull()
  expect(chainMismatch('mainnet', mainnet)).toBeNull()
  expect(chainMismatch('fork', mainnet)).toMatch(/not a fork/)
  expect(chainMismatch('mainnet', fork)).toMatch(/is a fork/)
  expect(chainMismatch('unset', fork)).toMatch(/names no network/)
})

test('on the fork, arm_rule answers with a link to the arming screen and nothing armed', async () => {
  const before = { net: process.env['AGON_NETWORK'], url: process.env['AGON_PUBLIC_URL'] }
  process.env['AGON_NETWORK'] = 'fork'
  process.env['AGON_PUBLIC_URL'] = 'https://agon.example'
  try {
    const link = (await callTool('arm_rule', SPEC)) as { url: string; wallet: string }
    expect(link.url).toBe(`https://agon.example/arm#wallet=${SPEC.wallet}`)
    expect(link.wallet).toBe(SPEC.wallet)
  } finally {
    for (const [k, v] of [
      ['AGON_NETWORK', before.net],
      ['AGON_PUBLIC_URL', before.url],
    ] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})
