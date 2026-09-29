import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { NetRequest, NetResult } from '@agon/core'
import { checkMints } from './mint-check.js'

// T-C04 budgets the mint check at exactly 1 `getMultipleAccounts`, forbids caching mint and freeze
// authority, and keeps RugCheck off the deciding path. All 3 are claims about which calls happen,
// so they are counted rather than reasoned about.

const recorded = JSON.parse(
  readFileSync('fixtures/recorded/rpc/799727ca03b92b4e.json', 'utf8'),
) as {
  request: { body: { params: [string[], unknown] } }
  response: { body: unknown }
}
const MINTS = recorded.request.body.params[0]

const spy = () => {
  const seen: NetRequest[] = []
  const net = async (req: NetRequest): Promise<NetResult> => {
    seen.push(req)
    return {
      status: 200,
      body: recorded.response.body,
      ms: 1,
      attempts: 1,
      slot: 450012073,
      fromFixture: true,
    }
  }
  return { seen, net }
}

const rpcMethod = (req: NetRequest): unknown =>
  (req.body as { method?: unknown } | undefined)?.method

test('30 mints cost exactly 1 getMultipleAccounts and 1 listing lookup', async () => {
  const { seen, net } = spy()
  await checkMints(MINTS, { net })
  expect(seen).toHaveLength(2)
  expect(rpcMethod(seen[0] as NetRequest)).toBe('getMultipleAccounts')
  expect(seen[1]?.url).toContain('tokens/v2/search')
})

test('mint and freeze authority are never cached, so a second look really looks', async () => {
  // A cached "no freeze authority" is the exact answer that lets funds move into a token that can
  // freeze them, and an authority can be handed to a new key between 2 blocks. So the second call
  // has to reach the chain again, and 1 call for 2 checks would mean it did not.
  const { seen, net } = spy()
  await checkMints(MINTS, { net })
  await checkMints(MINTS, { net })
  expect(seen.filter((r) => r.provider === 'rpc')).toHaveLength(2)
})

test('the chain and 1 keyless listing lookup are the whole deciding path, and RugCheck is not on it', async () => {
  // RugCheck is enrichment. If it ever appears here, an outage at a third party becomes our verdict.
  // The listing is on the path since T-F11b, and fails closed: no listing, no category, and style
  // fit answers unsure.
  const { seen, net } = spy()
  await checkMints(MINTS, { net })
  expect(seen.map((r) => r.provider)).toEqual(['rpc', 'jupiter'])
})

test('one mint costs the same 1 call as thirty', async () => {
  const { seen, net } = spy()
  await checkMints([MINTS[0] as string], { net })
  // 1 here, not 2: this spy answers with the 30-mint batch, so the 1-mint read fails closed, and a
  // mint the chain could not read is never looked up, which is the order that fails closed.
  expect(seen).toHaveLength(1)
})
