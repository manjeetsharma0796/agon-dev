// F11 (a) and (b): are Jev's answers always well formed, and how does latency grow with batching?
//
//   JEV_API_KEY=... node scripts/spike.mjs F11
//
// Live on purpose: latency cannot be replayed. With no key this writes nothing, because a
// result.json it did not measure is the one thing a spike must never produce.
//
// Batching: N questions ride in 1 call as 1 state of N numbered token texts and N choice
// questions, question k about item k. The texts are the 30 real token names in the committed
// Jupiter recording, cycled. Accuracy is not measured here; that is T-F11b's labelled cases.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildRequest } from '../../packages/guard/dist/index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const KEY = process.env.JEV_API_KEY
if (!KEY) {
  console.log('F11: not run, no JEV_API_KEY. Nothing written.')
  process.exit(0)
}
const URL_ = 'https://usejev.xyz/v1/systemone'
const CALLS = Number(process.env.F11_CALLS ?? 200)
const SIZES = [1, 5, 20]

const tokens = JSON.parse(
  readFileSync(`${here}../../fixtures/recorded/jupiter/748ef3fc5c082160.json`, 'utf8'),
).response.body.map((t) => `${t.name} (${t.symbol})`)

// The injection question exactly as the guard asks it, so the schema under test is ours.
const base = buildRequest([{ kind: 'injection', text: 'x' }]).questions.injection

const body = (n, offset) => {
  const items = Array.from({ length: n }, (_, k) => tokens[(offset + k) % tokens.length])
  const questions = {}
  items.forEach((_, k) => {
    questions[`q${k + 1}`] = {
      ...base,
      instructions: `About item ${k + 1} only: ${base.instructions}`,
    }
  })
  return { state: items.map((t, k) => `Item ${k + 1}: ${t}`).join('\n'), questions }
}

/** Every rule in thresholds.json's definition of valid, and which one failed. */
const invalid = (res, sent) => {
  if (res.status !== 200) return `HTTP ${res.status}`
  const answers = res.body?.answers
  if (typeof answers !== 'object' || answers === null) return 'no answers object'
  for (const [key, q] of Object.entries(sent.questions)) {
    const a = answers[key]
    const options = Object.keys(q.criteria)
    if (a === undefined) return `${key}: missing`
    if (a.type !== 'choice') return `${key}: type ${a.type}`
    if (!options.includes(a.choice)) return `${key}: choice ${JSON.stringify(a.choice)}`
    const p = a.probabilities ?? {}
    if (Object.keys(p).sort().join() !== [...options].sort().join())
      return `${key}: probability keys`
    if (Object.values(p).some((v) => typeof v !== 'number' || v < 0 || v > 1))
      return `${key}: probability out of range`
    const sum = Object.values(p).reduce((s, v) => s + v, 0)
    if (Math.abs(sum - 1) > 0.01) return `${key}: probabilities sum to ${sum}`
    if (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1)
      return `${key}: confidence ${a.confidence}`
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let rateLimited = 0
let inputTokens = 0

const call = async (sent) => {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now()
    const r = await fetch(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(sent),
    })
    const ms = performance.now() - t0
    const json = await r.json().catch(() => null)
    if (r.status === 429 && attempt < 5) {
      rateLimited++
      await sleep(2000 * (attempt + 1))
      continue
    }
    inputTokens += json?.usage?.input_tokens ?? 0
    return { status: r.status, body: json, ms }
  }
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)])
}

const perSize = {}
const failures = []
let responses = 0
for (const n of SIZES) {
  const times = []
  for (let i = 0; i < CALLS; i++) {
    const sent = body(n, i * n)
    const res = await call(sent)
    responses++
    const why = invalid(res, sent)
    if (why) failures.push({ size: n, call: i, why })
    else times.push(res.ms)
  }
  perSize[n] = { calls: CALLS, valid: times.length, p50: pct(times, 0.5), p95: pct(times, 0.95) }
  console.log(
    `F11: ${n} per call, p50 ${perSize[n].p50} ms, p95 ${perSize[n].p95} ms, ${times.length} valid`,
  )
}

const valid = responses - failures.length
const p95at20 = perSize[20].p95
const ratio = Math.round((p95at20 / perSize[1].p95) * 100) / 100
const pass = responses >= 500 && failures.length === 0 && p95at20 <= 500 && ratio <= 1.5

const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()

const result = {
  id: 'F11',
  pass,
  measured:
    `${valid} of ${responses} responses valid; p95 ${perSize[1].p95} ms at 1 question, ` +
    `${perSize[5].p95} ms at 5, ${p95at20} ms at 20, so 20-question p95 is ${ratio}x the ` +
    `1-question p95; ${rateLimited} rate-limited responses (429) retried; ${inputTokens} input ` +
    `tokens across all calls`,
  date: new Date().toISOString().slice(0, 10),
  commit,
  notes:
    'Parts (a) and (b) only. Round trip from the machine that ran it, not the deployment region. ' +
    'Texts are real token names, so this says nothing about accuracy, which is T-F11b.',
  perSize,
  failures: failures.slice(0, 20),
}
writeFileSync(`${here}result.json`, JSON.stringify(result, null, 2) + '\n')
console.log(`F11: ${pass ? 'PASS' : 'FAIL'}, ${result.measured}`)
