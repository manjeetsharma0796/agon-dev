// F9: does the benchmark give the same answer twice?
//
//   node scripts/spike.mjs F9
//
// The claim is not "the guardrail is deterministic", which is trivially true for a pure function
// over fixed input. It is that the *chain state* the guardrail reads is pinned, so two runs a day
// apart see the same accounts. That is the part that breaks silently: a bare mainnet fork is lazy
// and fetches each account the first time something touches it, at whatever slot the datasource is
// on right then, so two runs drift without anything failing.
//
// So each run starts its own surfpool from the committed snapshot with --offline, which makes a
// datasource call impossible rather than merely unnecessary. A sceptic reruns this with no Helius
// key, which is the difference between a reproducible benchmark and a screenshot.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkMints } from '../../packages/guard/dist/index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const SNAPSHOT = `${here}snapshot.json`
const PORT = 8899
const RUNS = 2

/** The binary is not committed and is not on a PR runner. Saying "not run" is the honest answer;
 *  writing a result.json we did not measure is the one thing a spike must never do. */
const surfpoolBin = () => {
  const named = process.env['SURFPOOL_BIN']
  if (named !== undefined && existsSync(named)) return named
  try {
    return execFileSync('sh', ['-c', 'command -v surfpool'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const rpc = async (method, params = []) => {
  const res = await fetch(`http://127.0.0.1:${PORT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`)
  return body.result
}

/** The guardrail reads the fork, not Helius. checkMints takes its caller, so nothing is stubbed. */
const forkNet = async (request) => {
  const res = await fetch(`http://127.0.0.1:${PORT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  })
  return {
    status: res.status,
    body: await res.json(),
    ms: 0,
    attempts: 1,
    slot: null,
    fromFixture: false,
  }
}

const waitReady = async (deadlineMs = 60_000) => {
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    try {
      return await rpc('getSlot')
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error(`surfpool did not answer on port ${PORT} within ${deadlineMs / 1000}s`)
}

const runOnce = async (bin, mints) => {
  const child = spawn(
    bin,
    [
      'start',
      '--snapshot',
      SNAPSHOT,
      '--offline',
      '--no-tui',
      '--no-studio',
      '--port',
      String(PORT),
      // Set explicitly, never inherited: at the default clock mode two runs drift on timing alone.
      '--block-production-mode',
      'clock',
      '--slot-time',
      '400',
    ],
    { stdio: 'ignore' },
  )
  try {
    const slot = await waitReady()
    const checks = await checkMints(mints, { net: forkNet })
    return {
      slot,
      verdicts: Object.fromEntries(
        mints.map((m) => {
          const c = checks.get(m)
          return [
            m,
            `${c?.verdict}:${(c?.reasons ?? [])
              .map((r) => r.rule)
              .sort()
              .join(',')}`,
          ]
        }),
      ),
    }
  } finally {
    child.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 1500))
  }
}

const bin = surfpoolBin()
if (bin === null) {
  console.log(
    'F9: not run, surfpool is not installed. Install it or set SURFPOOL_BIN, then run again. ' +
      'No result.json was written, so FEASIBILITY.md keeps reporting F9 as not run.',
  )
  process.exit(0)
}

// A null entry means "fetch this one from the remote RPC", which is a hole in the pin that only
// shows up as a different answer on a different day. Reject the snapshot rather than trust it.
// snapshot.json is the bare account map, which is what surfpool --snapshot takes. The slot it was
// pinned at lives beside it, because a bare map has nowhere to record its own provenance.
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const meta = JSON.parse(readFileSync(`${here}snapshot.meta.json`, 'utf8'))
const nulls = Object.entries(snapshot)
  .filter(([, v]) => v === null)
  .map(([k]) => k)
if (nulls.length > 0) {
  console.error(
    `::error::${nulls.length} snapshot entries are null and would be fetched live: ${nulls.slice(0, 5).join(', ')}`,
  )
  process.exit(1)
}

const labels = JSON.parse(readFileSync(`${here}../F3/mints.json`, 'utf8'))
const mints = ['blueChip', 'dangerousAuthority', 'dangerousToken2022'].flatMap((g) =>
  labels[g].map((m) => m.mint),
)

const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await runOnce(bin, mints))

const first = runs[0]
const differing = mints.filter((m) => runs.some((r) => r.verdicts[m] !== first.verdicts[m]))

// The threshold has 3 clauses and 1 of them, agent-side variance over 5+ runs per scenario, cannot
// run at all: OP-9 has not pinned a model. So this is not a pass, whatever the deterministic half
// says. The Kill criterion names dropping the live-agent comparison as the fallback, but taking a
// fallback is a checkpoint decision and not something the spike awards itself. FEASIBILITY.md says
// pass means the threshold was met on every listed input, and it was not.
const deterministic = differing.length === 0
const pass = false

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

writeFileSync(
  `${here}result.json`,
  `${JSON.stringify(
    {
      id: 'F9',
      pass,
      measured:
        `${mints.length - differing.length}/${mints.length} guardrail verdicts identical across ` +
        `${RUNS} runs from a clean surfpool on the snapshot pinned at slot ${meta.slot}, with no ` +
        `Helius key; agent-side variance 0 of the required 5 runs per scenario, because OP-9 has ` +
        `not pinned a model`,
      date: new Date().toISOString().slice(0, 10),
      commit,
      snapshotSlot: meta.slot,
      snapshotAccounts: Object.keys(snapshot).length,
      runs: runs.map((r) => ({ slot: r.slot })),
      differing,
      deterministicHalf: deterministic ? 'pass' : 'FAIL',
      agentHalf: 'not run, OP-9 open',
      notes:
        'Deterministic half only, which is the fallback the kill criterion names. Each run is its ' +
        'own surfpool process started with --offline from the committed snapshot, so no datasource ' +
        'call is possible and no Helius key is needed.',
    },
    null,
    2,
  )}\n`,
)

console.log(
  `F9: ${deterministic ? 'deterministic half pass, agent half not run' : 'FAIL'}, ` +
    `${mints.length - differing.length}/${mints.length} verdicts identical across ${RUNS} runs ` +
    `at snapshot slot ${meta.slot}`,
)
if (!deterministic) for (const m of differing) console.log(`  differs: ${m}`)
