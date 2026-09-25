#!/usr/bin/env node
// T-B08 use (1): a second-layer review escalation. Reads the diff itself and asks Jev whether it
// changes money math, transaction building, a frozen contract, or docs another track reads. It
// maps onto the same 4 "Second reviewer needed?" boxes in .github/pull_request_template.md, and it
// may only ADD a requirement to tick one, never remove one: the path-based checks already in
// board.yml (frozen contract, security review) stay primary and are untouched by this file.
//
// Kill criterion (TASKS.md T-B08): never used for anything numeric, for deciding a task is done,
// for approving a merge or a deploy, or for anything touching keys or funds. A Jev answer is an
// input to a written rule (does the ticked box match the flag), never the rule itself.
//
//   node scripts/jev-review.mjs self-test   0 network, 0 keys: proves the parsing and decision logic
//   node scripts/jev-review.mjs check       on a PR: ask Jev, cross-check the PR body's checkboxes
//   node scripts/jev-review.mjs measure [n] offline harness: real past merged PRs, real ground
//                                            truth from their own checkboxes, hit and false-flag
//                                            counts if JEV_API_KEY is set, dataset size if not
//
// Fails open. CLAUDE.md: "Analytics fail open but always state what they are based on." This is
// analytics, not a funds-moving path, so a missing key or an unreachable Jev degrades to "path
// rules only, Jev not consulted" and says so in the log, rather than blocking a PR on a third
// party's outage.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const ENDPOINT = 'https://usejev.xyz/v1/systemone'
// Keep the call gentle. Rate limits are not documented (OP-4), and a diff can run to megabytes;
// the review question does not need the whole thing to answer "does this touch money math".
const DIFF_CHAR_BUDGET = 20000
// Unvalidated. The row's own bar (38/40 hits, 8 or fewer false flags on 40 labelled diffs) is what
// should set this, and that measurement needs OP-4's key. Until then this is a starting guess, not
// a tuned value, and the PR says so.
const CONFIDENCE_THRESHOLD = 0.5

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

// The 4 categories, matching the 4 checkbox lines in .github/pull_request_template.md's
// "Second reviewer needed?" section exactly, so a "yes" maps onto a box a human can tick. The 5th
// box in that template ("a field name changed") is not one of the 4 things TASKS.md T-B08 asks
// Jev about, so it is left to the human and the path rules alone.
const CATEGORIES = {
  moneyMath: {
    instructions:
      'Does this diff change money math: realised P&L, position sizing, a spending cap, a stop ' +
      'distance, a price band, slippage, or a cost calculation?',
    yes: 'the diff adds or changes an arithmetic rule that decides an amount of money',
    no: 'the diff does not touch any calculation of an amount of money',
    box: /- \[x\] Money math \(P&L/i,
  },
  txBuilding: {
    instructions:
      'Does this diff build or sign a Solana transaction, build a Swig instruction, or touch the ' +
      'daemon or a signing key?',
    yes: 'the diff builds, signs or submits a transaction, or constructs a Swig instruction',
    no: 'the diff does none of that',
    box: /- \[x\] Builds a transaction or a Swig instruction/i,
  },
  frozenContract: {
    instructions:
      'Does this diff change the shape of one of the 3 frozen contracts in packages/core ' +
      '(check_trade, the report, or the rule spec)?',
    yes: 'the diff changes the shape of check_trade, the report, or the rule spec in packages/core',
    no: 'the diff leaves those 3 contracts alone',
    box: /- \[x\] Changes a frozen contract in/i,
  },
  crossTrackDocs: {
    instructions:
      'Does this diff change documentation, a schema note, or a contract description that a ' +
      'different track (decoder, benchmark, agent side, on-chain, product) relies on to do its ' +
      'own work?',
    yes: 'the diff changes docs, a schema note or a contract description another track reads',
    no: 'the diff only touches docs local to the track that wrote it, or touches no docs',
    box: /- \[x\] Changes docs another track reads/i,
  },
}

/** Build the request body for one batched call, in the shape packages/guard/src/jev/index.ts uses. */
function buildRequest(diffText) {
  const state = diffText.slice(0, DIFF_CHAR_BUDGET)
  const questions = {}
  for (const [key, c] of Object.entries(CATEGORIES)) {
    questions[key] = {
      type: 'choice',
      criteria: { yes: c.yes, no: c.no },
      instructions: c.instructions,
    }
  }
  return { state, questions }
}

/** Pure: turn a raw Jev response into a per-category flag. No network inside, so self-test covers it. */
function parseAnswers(raw) {
  const answers = raw && typeof raw === 'object' ? raw.answers : null
  const out = {}
  for (const key of Object.keys(CATEGORIES)) {
    const one = answers && typeof answers === 'object' ? answers[key] : null
    const confidence = typeof one?.confidence === 'number' ? one.confidence : 0
    const choice = typeof one?.choice === 'string' ? one.choice : null
    out[key] = {
      choice,
      confidence,
      flagged: choice === 'yes' && confidence >= CONFIDENCE_THRESHOLD,
    }
  }
  return out
}

/** Pure: which categories Jev flagged that the PR body's own checkbox does not yet cover. */
function missingReviewers(answers, prBody) {
  const missing = []
  for (const [key, c] of Object.entries(CATEGORIES)) {
    if (answers[key].flagged && !c.box.test(prBody)) missing.push(key)
  }
  return missing
}

async function askJev(diffText, apiKey) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(buildRequest(diffText)),
  })
  if (!res.ok) throw new Error(`Jev returned HTTP ${res.status}`)
  return parseAnswers(await res.json())
}

/** Local dev convenience only. CI sets JEV_API_KEY as a real environment variable from a secret. */
function readDotEnvKey(name) {
  if (process.env[name]) return process.env[name]
  if (!existsSync('.env')) return undefined
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line)
    if (m && m[1] === name) return m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return undefined
}

function assert(cond, message) {
  if (!cond) throw new Error(`self-test failed: ${message}`)
}

function selfTest() {
  const flagged = parseAnswers({
    answers: {
      moneyMath: { choice: 'yes', confidence: 0.9 },
      txBuilding: { choice: 'no', confidence: 0.8 },
      frozenContract: { choice: 'yes', confidence: 0.2 }, // below threshold: must not flag
      crossTrackDocs: { choice: 'no', confidence: 0.6 },
    },
  })
  assert(flagged.moneyMath.flagged === true, 'a yes at 0.9 confidence should flag')
  assert(flagged.txBuilding.flagged === false, 'a no should never flag')
  assert(flagged.frozenContract.flagged === false, 'a yes below the threshold should not flag')
  assert(flagged.crossTrackDocs.flagged === false, 'a no should never flag')

  const missingBox = missingReviewers(flagged, '- [ ] Money math (P&L, sizing, caps, costs)\n')
  assert(missingBox.length === 1 && missingBox[0] === 'moneyMath', 'unticked box must be reported')

  const tickedBox = missingReviewers(flagged, '- [x] Money math (P&L, sizing, caps, costs)\n')
  assert(tickedBox.length === 0, 'a ticked box must not be reported')

  const emptyRaw = parseAnswers(null)
  assert(
    Object.values(emptyRaw).every((a) => a.flagged === false),
    'a missing or malformed response must fail closed on the flag (never auto-require a reviewer it cannot support), and open on blocking (see check(): unreachable Jev never fails the PR)',
  )

  const unresolvedMissing = missingReviewers(emptyRaw, '')
  assert(unresolvedMissing.length === 0, 'a null response must never itself add a requirement')

  console.log('self-test: 6 checks passed, 0 network calls, 0 keys read.')
}

async function check() {
  const base = process.env.PR_BASE_SHA
  const head = process.env.PR_HEAD_SHA ?? 'HEAD'
  const body = process.env.PR_BODY ?? ''

  if (!base || /^0+$/.test(base)) {
    console.log('note: no PR_BASE_SHA, skipping the Jev review escalation.')
    return
  }

  let diff
  try {
    diff = git('diff', `${base}..${head}`)
  } catch (e) {
    // Fails open, same as an unreachable Jev below: a local git problem (a shallow checkout
    // missing the base sha, a malformed sha on a rerun) is not a reason to block a PR.
    console.log(
      `note: could not read the diff (${e instanceof Error ? e.message : String(e)}). ` +
        'Jev review escalation skipped; path rules only.',
    )
    return
  }
  if (!diff.trim()) {
    console.log('note: empty diff, nothing to ask Jev.')
    return
  }

  const apiKey = readDotEnvKey('JEV_API_KEY')
  if (!apiKey) {
    console.log(
      'note: JEV_API_KEY is not set (see OP-4). Jev review escalation skipped; path rules only.',
    )
    return
  }

  let answers
  try {
    answers = await askJev(diff, apiKey)
  } catch (e) {
    console.log(
      `note: Jev unreachable (${e instanceof Error ? e.message : String(e)}). Jev review ` +
        'escalation skipped; path rules only.',
    )
    return
  }

  for (const [key, a] of Object.entries(answers)) {
    console.log(
      `note: jev ${key} -> ${a.choice ?? 'unknown'} (confidence ${a.confidence.toFixed(3)})`,
    )
  }

  const missing = missingReviewers(answers, body)
  if (missing.length > 0) {
    console.error('\njev-review: this diff may need a reviewer the checklist does not yet name.\n')
    for (const key of missing) {
      console.error(
        `  - ${key}: Jev flagged this diff (confidence ${answers[key].confidence.toFixed(3)}) but ` +
          'the matching box in "Second reviewer needed?" is unticked.',
      )
    }
    console.error(
      '\nIf Jev is right, tick the box and name a reviewer. If it is wrong, say so in the PR: a ' +
        'Jev answer is an input to this check, never the rule itself.\n',
    )
    process.exit(1)
  }
  console.log('jev-review: no additional reviewer required.')
}

/**
 * Offline measurement harness. Assembles real diffs and real ground-truth labels from this repo's
 * own merged `feature/*` PRs (their own "Second reviewer needed?" checkboxes, ticked by a human at
 * the time), then, only if a key is present, calls Jev on each and tallies hits and false flags
 * against the row's own bar. With no key it still reports the one honest number available in this
 * environment: how many real, labelled diffs are ready for that measurement.
 */
async function measure(limitArg) {
  const limit = Number(limitArg) > 0 ? Number(limitArg) : 100
  const list = JSON.parse(
    execFileSync(
      'gh',
      ['pr', 'list', '--state', 'merged', '--limit', String(limit), '--json', 'number,headRefName'],
      { encoding: 'utf8' },
    ),
  )
  const prs = list.filter((p) => p.headRefName.startsWith('feature/'))
  console.log(`note: ${prs.length} merged feature/* PRs found, of ${list.length} merged PRs total.`)

  const apiKey = readDotEnvKey('JEV_API_KEY')
  const dataset = []
  for (const p of prs) {
    const prBody = execFileSync(
      'gh',
      ['pr', 'view', String(p.number), '--json', 'body', '--jq', '.body'],
      {
        encoding: 'utf8',
      },
    )
    const diff = execFileSync('gh', ['pr', 'diff', String(p.number)], { encoding: 'utf8' })
    if (!diff.trim()) continue
    const truth = {}
    for (const [key, c] of Object.entries(CATEGORIES)) truth[key] = c.box.test(prBody)
    dataset.push({ number: p.number, diff, truth })
  }
  console.log(`note: ${dataset.length} of those carry a non-empty diff and a readable PR body.`)

  const truthCounts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]))
  for (const d of dataset) for (const k of Object.keys(CATEGORIES)) if (d.truth[k]) truthCounts[k]++
  console.log(`note: ground truth from the PRs' own checkboxes: ${JSON.stringify(truthCounts)}`)

  if (!apiKey) {
    console.log(
      `\nmeasure: JEV_API_KEY not set (see OP-4). ${dataset.length} real labelled diffs assembled ` +
        'and ready; 0 called against the live endpoint in this run. This is the honest number for ' +
        'an environment with no key, not the 38/40 bar in TASKS.md T-B08, which needs a live run.',
    )
    return
  }

  // A "hit" requires Jev to flag the SAME category a human already ticked, not just any category
  // on a diff that happens to need some review; matching on "any flag vs any truth" would count a
  // diff as caught when Jev flagged transaction-building on a diff that only needed a money-math
  // reviewer, which is not what check() rewards: missingReviewers() compares per category, and
  // that is the unit this harness measures against too.
  let hits = 0
  let falseFlags = 0
  let misses = 0
  let called = 0
  for (const d of dataset) {
    let answers
    try {
      answers = await askJev(d.diff, apiKey)
      called++
    } catch (e) {
      console.log(
        `note: PR #${d.number} call failed (${e instanceof Error ? e.message : String(e)})`,
      )
      continue
    }
    const keys = Object.keys(CATEGORIES)
    const needsReview = keys.some((k) => d.truth[k])
    const caughtTheRightCategory = keys.some((k) => d.truth[k] && answers[k].flagged)
    const flaggedAWrongCategory = keys.some((k) => !d.truth[k] && answers[k].flagged)
    if (needsReview && caughtTheRightCategory) hits++
    if (needsReview && !caughtTheRightCategory) misses++
    if (flaggedAWrongCategory) falseFlags++
  }
  console.log(
    `\nmeasure: ${called} of ${dataset.length} diffs called. ${hits} hits, ${falseFlags} false ` +
      `flags, ${misses} misses, against the bar of 38+/40 hits with 8 or fewer false flags on 40 ` +
      'labelled diffs. A hit needs Jev to flag the same category a human ticked, not merely any ' +
      'category on a diff that needed one.',
  )
}

const [, , mode, arg] = process.argv
if (mode === 'self-test') selfTest()
else if (mode === 'check') await check()
else if (mode === 'measure') await measure(arg)
else {
  console.error('usage: node scripts/jev-review.mjs <self-test|check|measure [n]>')
  process.exit(1)
}
