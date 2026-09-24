# Jev in our own dev workflow, a one-week trial

T-B08. Written 2026-09-24. The row names 4 uses, each kept or cut at CP2 on its own pre-written
bar. This PR builds use (1) only, in scope and for a reason: the timebox for this task is short,
and use (1) is first in the row's own priority order, the only one with a fully specified bar that
does not need a person to hand-label live beta traffic first (uses 2 to 4 all need a week of real
usage to even start measuring). Building 1 use well and being honest about the other 3 is worth
more than 4 half-built ones. Uses (2), (3) and (4) are not started; their rows in TASKS.md T-B08
stay open for whoever picks this up next.

## Use (1), second-layer review escalation

A CI script, `scripts/jev-review.mjs`, reads a PR's diff itself and asks Jev 4 yes/no questions,
one per category named in the row: does the diff change money math, transaction building, a
frozen contract, or docs another track reads. Those 4 categories are exactly the first 4
"Second reviewer needed?" checkboxes in `.github/pull_request_template.md`, on purpose: Jev's
answer is compared against whether the matching box is already ticked, and a flagged-but-unticked
category fails the CI check, asking the author to tick the box and name a reviewer.

That is the whole mechanism, and it is deliberately narrow:

- **It can only add a requirement, never remove one.** The 2 existing path-based gates in
  `board.yml` (the frozen-contract diff check, the signing-code security-review check) run
  unmodified, before and independently of this script. If Jev is wrong, or unreachable, or has no
  key, those 2 gates still fire on their own path rules. This script only ever adds a third,
  content-based trigger for the same 4 checkboxes the template already carries.
- **It never approves anything.** A "no" from Jev does not unTick a box, does not skip the
  frozen-contract or security-review gates, and does not mark a PR mergeable. All it does is fail
  the check when a box looks like it should be ticked and is not, exactly the same mechanism the
  2 existing gates already use (a regex over the PR body), so there is nothing new for a reviewer
  to trust.
- **It fails open.** CLAUDE.md: "Analytics fail open but always state what they are based on."
  This is analytics, not a funds-moving path. A missing `JEV_API_KEY` or an unreachable endpoint
  logs a note ("path rules only") and exits 0, rather than blocking every PR on a third party's
  uptime.
- **Nothing numeric ever comes back.** All 4 questions in `scripts/jev-review.mjs` are `choice`,
  never `score` and never `noul`. `parseAnswers()` reads exactly 2 fields off each answer, `choice`
  and `confidence`, and `confidence` is only ever compared against a threshold before adding a
  checkbox requirement, never surfaced as a score of anything or written anywhere numeric matters.

Request shape reused from `packages/guard/src/jev/index.ts` (T-C05): one batched call, `state` is
the diff text (capped at 20,000 characters so a huge diff does not turn into a slow or expensive
call the endpoint's undocumented rate limit was never measured against), `questions` is a record of
`choice` questions each with a `criteria` object of exactly 2 named options, `yes` and `no`.

`noul` was considered and rejected again here, on top of T-C05's own reason. A fresh data point,
not from this session (no live key), asked `noul` "Is this urgent?" on 3 texts: "the checkout has
been down for an hour" scored 0.0226, "repaint the office kitchen next spring" scored 0.0086, and
"every customer payment is failing and we are losing money right now" scored 0.0043, the lowest of
the 3 for the most urgent case. `noul` is not merely weak here, it is inverted: ranking these 3 by
`noul` score puts the actual emergency last. `choice` with named criteria, on the same shape of
question, returns a `confidence` that was 0.998 on an obvious case and 0.001 when it was guessing,
which is why `scripts/jev-review.mjs` uses `choice` exclusively and treats `confidence` as the only
usable signal, same as T-C05.

**A tension with CLAUDE.md worth reading, not hiding.** CLAUDE.md's Non-negotiable section reads
"Jev answers only 3 non-numeric questions: token category, impersonation, injection screen",
unqualified. This script asks Jev 4 different questions, none of the 3. Both the row in TASKS.md
and this session's task brief describe exactly this design, so it is deliberate and not an
oversight in this PR, but the written rule in CLAUDE.md does not carve out an exception for it, and
an agent should not quietly decide on its own whether the 3-question line means "the trading guard"
or "everywhere". Written up as OP-20 in `OPERATOR_TODO.md` for a person to resolve either by
scoping CLAUDE.md's wording to the trading guard, or by saying T-B08 does not get an exception. The
one thing this script does keep, regardless of that decision: it never reads a number back from
Jev, only a `choice` and a `confidence` used as a threshold gate, the same non-negotiable that
motivates the 3-question rule in the first place.

## The row's own bar, and what was actually measured

> kept only if it catches 38 or more of 40 labelled past diffs with 8 or fewer false flags

**Not measured. Reported honestly as not measured, not as a pass.** This environment has no
`JEV_API_KEY`: no `.env` file, no environment variable, nothing in the session. OP-4, which this
row depends on, is still `open` in `OPERATOR_TODO.md`; its own "Done when" line, a 200-call run
with no 429, has not happened yet. The one existing data point in OP-4, a 10-call p50 of 607 ms
measured 2026-09-24, was taken with a key that is not available here. Faking a hit rate to look
done is exactly what CLAUDE.md forbids ("Never fake a credential, a verification or a
measurement"), so the honest state is written down instead.

What could be measured without a key, and was:

`node scripts/jev-review.mjs measure` assembles the labelled half of the bar for free, from this
repo's own history instead of an invented set. It pulls every merged `feature/*` PR (the trivial
one-line `claim/*` and `board/*` PRs are excluded, they carry no real diff), reads each one's own
PR body for its ground truth (whichever of the 4 "Second reviewer needed?" boxes a human actually
ticked at review time), and would call Jev on each diff if a key were present. A "hit" only counts
when Jev flags the same category a human actually ticked, not merely any category on a diff that
needed some review; the first version of this comparison counted a diff as caught whenever both
sides flagged anything at all, which would have let a money-math diff read as a hit off a wrongly
flagged transaction-building answer. Caught in this PR's own `/code-review` pass before anything
was measured against a real key, not after.

Real, measured, 2026-09-24, 0 keys:

- 29 merged `feature/*` PRs found, of 69 merged PRs total.
- 29 of those carry a non-empty diff and a readable PR body, so 29 is the size of the labelled set
  this repo can supply today. It is short of the 40 the bar asks for; the row already expected
  this ("you almost certainly cannot assemble 40 labelled past diffs in the time available").
- Ground truth pulled from the PRs' own checkboxes: 3 ticked money math, 4 ticked
  transaction-building/security-review, 0 ticked frozen contract, 11 ticked cross-track docs.
- 0 of the 29 were sent to the live endpoint. Calling `measure` with `JEV_API_KEY` set will call
  Jev once per assembled diff and report hits, false flags and misses against the same 38-of-40
  and 8-false-flags-or-fewer bar, so the full measurement is 1 command away from OP-4 landing a
  key, not a rewrite.

**Kept or cut:** neither, yet. The bar in TASKS.md T-B08 cannot be evaluated without the
measurement above, so this PR does not claim it was met and does not set Status to `done`. The row
stays `in-review` until OP-4 lands a key and someone runs `node scripts/jev-review.mjs measure`
against the 29 (soon to be more, as more `feature/*` PRs merge) real diffs this repo already has,
or a person adds to the labelled set by hand.

## Workflow wiring

`board.yml`'s `hygiene` job gets 2 new steps, both cheap and gentle:

1. `node scripts/jev-review.mjs self-test`, always, 0 network, 0 keys: proves the parsing and
   decision logic (does a `yes` above the confidence threshold flag, does a `no` never flag, does
   a ticked box clear a flag, does a missing or malformed Jev response fail closed on the flag and
   open on blocking) without needing the live endpoint. This is the "one meaningful check" for
   this change; it is not money logic, so it does not get the money-logic failing-test-first
   treatment, and it lives inside the one file this task's `Touches:` line allows rather than as a
   separate `scripts/jev-review.test.mjs`.
2. `node scripts/jev-review.mjs check`, on `opened`, `synchronize` and `reopened` only (not
   `edited`, so an author editing the PR description does not trigger another call to a
   rate-limit-undocumented third party for text that did not change code), reads
   `PR_BASE_SHA`/`PR_HEAD_SHA`/`PR_BODY` the same way the existing steps in this job do, and needs
   a `JEV_API_KEY` repository secret to do anything beyond logging "path rules only".

**This PR could not push the `board.yml` change.** The GitHub token available in this session has
`gist`, `read:org` and `repo` scopes and not `workflow`, and GitHub refuses a push that touches
`.github/workflows/*.yml` without that scope. Rather than fight the token, the exact one-line
addition needed is below, unapplied, for whoever has `workflow` scope to paste into the `hygiene`
job in `.github/workflows/board.yml`, directly after the existing "Signing code needs a security
review" step:

```yaml
      - name: Jev review script self-test
        run: node scripts/jev-review.mjs self-test

      - name: Second-layer review escalation (Jev)
        if: github.event.action != 'edited'
        env:
          JEV_API_KEY: ${{ secrets.JEV_API_KEY }}
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}
          PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: node scripts/jev-review.mjs check
```

The `JEV_API_KEY` secret itself is OP-4's job, not this PR's: `scripts/jev-review.mjs` reads it
from `process.env` at call time only (`check()` and `measure()`, never at module load), so
`pnpm gates` passes with 0 keys set and importing or linting the script never touches it.

## Kill criterion, restated

TASKS.md T-B08: never used for anything numeric, for deciding a task is done, for approving a
merge or a deploy, or for anything touching keys or funds. `scripts/jev-review.mjs` never reads a
numeric answer type (`choice` only, same as T-C05), never sets a task's Status, never marks a PR
approved (it can only fail a check that a human then resolves by ticking a box and naming a
reviewer, same mechanism the 2 existing gates already use), and touches no key material beyond
reading its own bearer token for the one HTTP call it makes. Any of the 4 categories it flags is an
input to the written rule ("is the matching box ticked"), never the rule itself.
