#!/usr/bin/env node
// Enforces the TASKS.md protocol. Node builtins only, so it runs before the workspace exists.
//
//   node scripts/board.mjs lint          always: the board is well formed
//   node scripts/board.mjs claim-push    on a direct push to dev: Status lines only
//   node scripts/board.mjs pr            on a PR: branch, body and diff hygiene
//   node scripts/board.mjs summary       rewrite the status table in README.md
//
// Every check here exists because the PRD names the failure it prevents. Do not soften one
// without changing the PRD first.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const errors = []
const warnings = []
const fail = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const FIELDS = ['Status', 'Depends-on', 'Touches', 'Serves', 'Acceptance', 'Evidence']
const JUDGED = [
  'Functionality',
  'Potential impact',
  'Novelty',
  'UX',
  'Open source',
  'Business plan',
]
const PLACEHOLDER = /^(<.*>|tbd|todo|n\/a|none|-|\?+)$/i

function parseTasks(text, lineOffset = 0) {
  const tasks = []
  let current = null
  let field = null // the field a wrapped continuation line belongs to
  // Split on \r?\n. On a Windows checkout every line would otherwise keep its \r, and JS "." does
  // not match \r, so every "$"-anchored row regex below silently matches nothing.
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const head = /^### (T-[A-Z]?\d+[a-z]?|OP-\d+),\s*(.+)$/.exec(line)
    if (head) {
      current = { id: head[1], title: head[2], line: lineOffset + i + 1, fields: {} }
      tasks.push(current)
      field = null
      continue
    }
    if (line.startsWith('### ')) current = null
    if (!current) continue

    const start = /^- ([A-Za-z-]+(?: criterion)?):\s*(.*)$/.exec(line)
    if (start) {
      field = start[1]
      current.fields[field] = start[2].trim()
      continue
    }
    // A row wraps across lines, so an indented line continues the field above it. Without this the
    // number in a wrapped Acceptance line is invisible and every long row fails the lint.
    if (field && /^\s+\S/.test(line)) {
      current.fields[field] = `${current.fields[field]} ${line.trim()}`.trim()
      continue
    }
    field = null
  }
  return tasks
}

function lint() {
  if (!existsSync('TASKS.md')) return fail('TASKS.md is missing. It is the board.')
  const text = readFileSync('TASKS.md', 'utf8')
  // Section 4 shows the row format inside a fenced block. Skip it or every rule trips on the example.
  const [before, ...rest] = text.split(/\r?\n## 5\./)
  const body = rest.length > 0 ? rest.join('\n## 5.') : text
  // Report the line as it appears in the file, not in the sliced body, or the lint sends people to
  // the wrong line.
  const tasks = parseTasks(body, rest.length > 0 ? before.split(/\r?\n/).length : 0)
  if (tasks.length === 0) return fail('No task rows found in TASKS.md below section 5.')

  const ops = existsSync('OPERATOR_TODO.md')
    ? new Set(parseTasks(readFileSync('OPERATOR_TODO.md', 'utf8')).map((t) => t.id))
    : new Set()
  const ids = new Set(tasks.map((t) => t.id))
  const seen = new Set()
  const claims = new Map()

  for (const t of tasks) {
    const at = `TASKS.md:${t.line} ${t.id}`
    if (seen.has(t.id)) fail(`${at}: duplicate task id.`)
    seen.add(t.id)

    for (const f of FIELDS) {
      if (t.fields[f] === undefined) fail(`${at}: missing "- ${f}:" line.`)
    }

    const status = t.fields.Status ?? ''

    // Serves: must name something judged or measured. Prevents polishing what nobody sees.
    const serves = t.fields.Serves ?? ''
    if (!serves || PLACEHOLDER.test(serves)) {
      fail(`${at}: "Serves:" is empty. Name a judged criterion or a measured user metric.`)
    } else if (
      !JUDGED.some((j) => serves.includes(j)) &&
      !/\b(judged|rate|share|gate|latency|metric|cost|retention|unblocks)\b/i.test(serves)
    ) {
      fail(`${at}: "Serves: ${serves}" names no judged criterion and no measured metric.`)
    }

    // Acceptance: must contain a number. A task without one is a wish.
    const acceptance = t.fields.Acceptance ?? ''
    if (!/\d/.test(acceptance)) {
      fail(`${at}: "Acceptance:" has no number in it, so nothing can be checked.`)
    }

    // Honest status: done needs evidence that is not a placeholder.
    const evidence = t.fields.Evidence ?? ''
    if (/^done\b/.test(status) && PLACEHOLDER.test(evidence)) {
      fail(`${at}: Status is done but "Evidence: ${evidence}" is a placeholder.`)
    }

    // Depends-on must point at real rows, or a spike cannot be sequenced.
    const deps = (t.fields['Depends-on'] ?? '').trim()
    if (deps && !/^none$/i.test(deps)) {
      for (const dep of deps
        .split(/[,;]/)
        .map((d) => d.trim())
        .filter(Boolean)) {
        if (dep.startsWith('OP-')) {
          if (!ops.has(dep)) fail(`${at}: Depends-on ${dep}, which is not in OPERATOR_TODO.md.`)
        } else if (!ids.has(dep)) {
          fail(`${at}: Depends-on ${dep}, which is not a task in this file.`)
        }
      }
    }

    // blocked must point at a real operator item, or the block is invisible to the human queue.
    const blocked = /^blocked,\s*see\s*(OP-\d+)/.exec(status)
    if (/^blocked/.test(status) && !blocked) {
      fail(`${at}: Status is blocked but does not say "blocked, see OP-N".`)
    } else if (blocked && !ops.has(blocked[1])) {
      fail(
        `${at}: blocked on ${blocked[1]}, which is not in OPERATOR_TODO.md. Write it there first.`,
      )
    }

    // The lock: one owner per task, and the branch matches the id.
    const claim = /^claimed\s+(\S+)\s*\|\s*Owner:\s*(.+?)\s*\|\s*Branch:\s*(\S+)$/.exec(status)
    if (/^claimed/.test(status)) {
      if (!claim) {
        fail(
          `${at}: Status is claimed but not in the form "claimed <date> | Owner: <name> | Branch: <branch>".`,
        )
      } else {
        const [, , owner, branch] = claim
        if (PLACEHOLDER.test(owner)) fail(`${at}: claimed with placeholder owner "${owner}".`)
        const want = `feature/${t.id.toLowerCase()}-`
        if (!branch.startsWith(want)) {
          fail(`${at}: branch "${branch}" must start with "${want}".`)
        }
        if (claims.has(branch)) {
          fail(`${at}: branch "${branch}" is already claimed by ${claims.get(branch)}.`)
        }
        claims.set(branch, t.id)
      }
    }
    if (!/^(open|claimed|blocked|in-review|done|cut)\b/.test(status)) {
      fail(`${at}: Status "${status}" is not one of open, claimed, blocked, in-review, done, cut.`)
    }

    // Touches: is what keeps parallel tasks independent.
    if (PLACEHOLDER.test(t.fields.Touches ?? '')) {
      fail(`${at}: "Touches:" must list the files this task owns, so parallel tasks stay disjoint.`)
    }

    // A spike with no stated fallback is an unmanaged existential risk.
    if (t.id.startsWith('T-F') && !t.fields['Kill criterion']) {
      fail(
        `${at}: a feasibility spike needs a "- Kill criterion:" line naming its fallback or cut.`,
      )
    }
  }
  return tasks
}

function changedFiles(base, head) {
  return git('diff', '--name-only', `${base}..${head}`).split('\n').filter(Boolean)
}

// A claim moves a "- Status:" line and nothing else. Shared by the claim-PR path and by any direct
// push, so the rule lives in exactly one place.
function assertStatusOnly(base, head, what) {
  // README.md is here because the board summary inside it is a pure function of the Status lines
  // this very change moves. Without it a claim can never merge: moving a Status line changes the
  // summary counts, the "Generated files are current" job then fails on a stale README, and fixing
  // that README is forbidden by this check. That deadlocked every claim, which is the first step of
  // every task. Its content is deliberately not inspected below: the generated-files job already
  // requires it to equal `board.mjs summary` output exactly, so it cannot smuggle anything in.
  const edited = ['TASKS.md', 'OPERATOR_TODO.md']
  const allowed = [...edited, 'README.md']
  for (const f of changedFiles(base, head)) {
    if (!allowed.includes(f)) {
      fail(
        `"${f}" changed in ${what}. A claim may only change "- Status:" lines in TASKS.md or ` +
          `OPERATOR_TODO.md, plus the regenerated README.md summary. Code and prose go in a ` +
          `feature PR of their own.`,
      )
    }
  }
  const diff = git('diff', '-U0', `${base}..${head}`, '--', ...edited)
  for (const line of diff.split('\n')) {
    // Skip the diff own headers only. Do not skip every line whose second character is a dash:
    // markdown list items all start "+-" or "--", which is exactly what this check has to read.
    if (/^(\+\+\+|---|@@|diff |index |new file|deleted file|similarity|rename )/.test(line))
      continue
    if (!/^[+-]/.test(line)) continue
    if (!/^[+-]-\s*(Status|Owner):/.test(line)) {
      fail(`A claim changes only "- Status:" lines. This one changed: ${line.trim().slice(0, 140)}`)
    }
  }
}

// Any push that reached dev without a pull request. The ruleset should already have blocked it, so
// this is the second line: if protection is ever relaxed, the rule still holds.
function claimPush() {
  const base = process.env.BEFORE_SHA
  const head = process.env.AFTER_SHA ?? 'HEAD'
  if (!base || /^0+$/.test(base)) return warn('No BEFORE_SHA, skipping the claim-push check.')
  assertStatusOnly(base, head, 'a direct push to dev')
}

// A PR is where the hygiene rules bite: real claim, right branch, justified dependency, small diff.
function pr() {
  const branch = process.env.PR_BRANCH ?? ''
  const body = process.env.PR_BODY ?? ''
  const base = process.env.PR_BASE_SHA
  const head = process.env.PR_HEAD_SHA ?? 'HEAD'

  // Adding, cutting or rewording a task is not a claim and not a task. It needs its own path, or
  // the Friday /ponytail-debt pass and every scope cut has nowhere legal to land.
  if (branch.startsWith('board/')) {
    if (!/^board\/[a-z0-9-]+$/.test(branch)) {
      fail(
        `Board branch "${branch}" must be "board/<slug>", all lower case, e.g. board/cut-screener.`,
      )
    }
    if (!base || /^0+$/.test(base)) return warn('No PR_BASE_SHA, skipping the board diff check.')
    // Same reason as assertStatusOnly: adding or cutting a task moves the counts in the generated
    // README summary, so a board PR has to be able to carry the regenerated file with it.
    const allowed = ['TASKS.md', 'OPERATOR_TODO.md', 'README.md']
    for (const f of changedFiles(base, head)) {
      if (!allowed.includes(f)) {
        fail(`"${f}" changed in a board/ PR, which may only edit ${allowed.join(', ')}.`)
      }
    }
    return
  }

  // dev requires a pull request, so a claim is a PR too. It carries only the Status line, which is
  // what keeps the race resolvable: the second claim PR conflicts on that exact line.
  if (branch.startsWith('claim/')) {
    if (!/^claim\/(t-[a-z]?\d+[a-z]?|op-\d+)$/.test(branch)) {
      fail(`Claim branch "${branch}" must be "claim/t-<id>" or "claim/op-<n>", e.g. claim/t-a03.`)
    }
    if (!base || /^0+$/.test(base)) return warn('No PR_BASE_SHA, skipping the claim diff check.')
    return assertStatusOnly(base, head, 'this claim PR')
  }

  const idMatch = /^feature\/(t-[a-z]?\d+[a-z]?)-[a-z0-9-]+$/.exec(branch)
  if (!idMatch) {
    fail(
      `Branch "${branch}" must be "feature/t-<id>-<slug>", all lower case, e.g. feature/t-a03-meteora.`,
    )
  } else {
    const id = idMatch[1].toUpperCase()
    const tasks = parseTasks(readFileSync('TASKS.md', 'utf8'))
    const task = tasks.find((t) => t.id === id)
    if (!task) {
      fail(`Branch names task ${id}, which has no row in TASKS.md. Claim it first.`)
    } else if (!/^(claimed|in-review)/.test(task.fields.Status ?? '')) {
      fail(
        `${id} is "${task.fields.Status}". Claim it first, with a claim/${idMatch[1]} PR that moves ` +
          `only its Status line. If that PR conflicts, someone beat you to it: pick another task.`,
      )
    } else if (!(task.fields.Status ?? '').includes(branch)) {
      fail(`${id} is claimed with a different branch than "${branch}".`)
    }
  }

  if (
    !/^\s*\*\*Serves:\*\*|(^|\n)\*\*Serves:\*\*/m.test(body) ||
    /\*\*Serves:\*\*\s*(\n|$)/.test(body)
  ) {
    fail('The PR body needs a filled-in "**Serves:**" line. What does this move?')
  }

  if (!base || /^0+$/.test(base)) return warn('No PR_BASE_SHA, skipping the diff checks.')

  // A new dependency needs a reason the stdlib will not do.
  const pkgDiff = git('diff', `${base}..${head}`, '--', '**/package.json', 'package.json')
  const added = [...pkgDiff.matchAll(/^\+\s*"([^"]+)":\s*"[^"]*"\s*,?$/gm)].map((m) => m[1])
  if (added.length > 0 && !/\*\*Dependency:\*\*\s*\S/.test(body)) {
    fail(
      `This PR adds ${added.length} dependency entry/entries (${added.join(', ')}) with no ` +
        `"**Dependency:**" line saying why the stdlib, a native feature or an installed package will not do.`,
    )
  }

  // Diffs over 600 lines get split or explained.
  const stat = git('diff', '--numstat', `${base}..${head}`)
  let changed = 0
  for (const line of stat.split('\n').filter(Boolean)) {
    const [add, del, file] = line.split('\t')
    if (
      /^(pnpm-lock\.yaml|package-lock\.json|fixtures\/|benchmark\/results\/|spikes\/\S+\/result\.json)/.test(
        file ?? '',
      )
    )
      continue
    changed += (Number(add) || 0) + (Number(del) || 0)
  }
  if (changed > 600 && !/\*\*Diff-size:\*\*\s*\S/.test(body)) {
    fail(
      `Diff is ${changed} changed lines, over 600. Split the PR, or add a "**Diff-size:**" line saying why not.`,
    )
  }

  // No em dashes or en dashes. Cheap to check, annoying to fix later.
  const full = git('diff', `${base}..${head}`)
  const dashes = full.split('\n').filter((l) => /^\+/.test(l) && /[–—]/.test(l))
  if (dashes.length > 0) {
    fail(
      `${dashes.length} added line(s) contain an em dash or en dash. Use a plain hyphen. First: ${dashes[0].trim().slice(0, 120)}`,
    )
  }
}

// The README carries the board summary so the repo answers "where are we?" without opening TASKS.md.
function summary(tasks) {
  if (!existsSync('README.md')) return warn('No README.md yet, skipping the summary.')
  const count = (re) => tasks.filter((t) => re.test(t.fields.Status ?? '')).length
  const rows = [
    ['open', count(/^open/)],
    ['claimed', count(/^claimed/)],
    ['blocked', count(/^blocked/)],
    ['in-review', count(/^in-review/)],
    ['done', count(/^done/)],
    ['cut', count(/^cut/)],
  ]
  const table = [
    '<!-- board:start -->',
    // No date: it would change daily and CI could not tell a stale summary from a fresh one.
    'Board, generated by `scripts/board.mjs summary`. Do not hand-edit.',
    '',
    `| ${rows.map(([k]) => k).join(' | ')} |`,
    `|${rows.map(() => '---').join('|')}|`,
    `| ${rows.map(([, v]) => v).join(' | ')} |`,
    '<!-- board:end -->',
  ].join('\n')
  const readme = readFileSync('README.md', 'utf8')
  const next = /<!-- board:start -->[\s\S]*?<!-- board:end -->/.test(readme)
    ? readme.replace(/<!-- board:start -->[\s\S]*?<!-- board:end -->/, table)
    : `${readme.trimEnd()}\n\n${table}\n`
  if (next !== readme) writeFileSync('README.md', next)
}

const mode = process.argv[2] ?? 'lint'
const tasks = lint() ?? []
if (mode === 'claim-push') claimPush()
if (mode === 'pr') pr()
if (mode === 'summary') summary(tasks)

for (const w of warnings) console.log(`note: ${w}`)
if (errors.length > 0) {
  console.error(`\nboard: ${errors.length} problem(s).\n`)
  for (const e of errors) console.error(`  - ${e}`)
  console.error('\nThe rules are in TASKS.md sections 1 to 4.\n')
  process.exit(1)
}
console.log(`board: ${mode} ok, ${tasks.length} rows.`)
