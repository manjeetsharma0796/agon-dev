# TASKS.md, the Agon board

The board and the lock. Nothing else is the board: not an issue tracker, not a chat message.

**If you are an agent or a person about to write code, read sections 1 to 3 first. They are the
whole protocol. Then claim exactly one task and work only on that task.**

Source of truth for scope, numbers and dates: `PRD.md`. Every acceptance number here is copied
from it verbatim. If a number here disagrees with the PRD, the PRD wins and you fix this file in
the same commit. Decisions taken since the PRD was written are in `DECISIONS.md`, and where the
two disagree `DECISIONS.md` wins, because it is dated.

Day 1 is 2026-09-24. CP1 2026-09-27, CP2 2026-10-02, CP3 2026-10-08, World's Fair
submission 2026-10-11, CP4 2026-10-16, CP5 2026-10-23, CP6 2026-10-30, fall submission
2026-11-01.

---

## 1. The lock: claim before you write code

One task, one owner, one branch, one PR. The race is settled by git, not by asking.

`dev` is protected: **nobody can push to it, including whoever owns the repo.** Every change
arrives as a pull request with its checks green. So a claim is a tiny PR carrying one line, and that
is what keeps the race resolvable: the second claim PR on the same task conflicts on that exact
line and cannot merge.

```bash
git checkout dev && git pull --ff-only origin dev
git checkout -b claim/t-a03
# edit ONLY the `- Status:` line of the task you want, nothing else in the file
node scripts/board.mjs summary   # the README counts change with your Status line
git commit -am "claim T-A03" && git push -u origin claim/t-a03
gh pr create --fill --base dev && gh pr merge --auto --squash --delete-branch
```

If the merge is refused for a conflict, or the board lint says the task is already claimed,
**someone beat you to it. Pick another task. Never work on a task claimed by someone else.**

Then branch off the updated `dev` and do the work:

```bash
git checkout dev && git pull --ff-only origin dev
git checkout -b feature/t-a03-meteora
```

Rules the ruleset and the `board` CI job enforce, so do not argue with them:

- **No pushes to `dev`, ever.** No force pushes, no deletion, no bypass for admins.
- A claim PR is branch `claim/t-<id>` and may change **only** `- Status:` lines in `TASKS.md` and
  `OPERATOR_TODO.md`, plus the `README.md` summary that `node scripts/board.mjs summary`
  regenerates from them. Anything else in that diff fails. Forget the regenerate step and the
  `hygiene` job fails on a stale README, so it is part of the claim, not an afterthought.
- A work PR is branch `feature/t-<id>-<slug>` and must match the `Branch:` in the row you claimed.
- Adding, cutting or rewording a task is neither of those. It goes in a `board/<slug>` PR that
  touches only `TASKS.md` and `OPERATOR_TODO.md`. That is the path for the Friday
  `/ponytail-debt` pass and for every checkpoint cut.
- Two owners on one task fails the lint.
- `Status: done` without a real `Evidence:` link fails the lint.
- `secrets`, `checks`, `hygiene` and `spikes` must all be green, on a branch up to date with `dev`.
  Being up to date is what makes the double-claim check bite before the merge rather than after.

Status values: `open` | `claimed <date> | Owner: <name> | Branch: <branch>` |
`blocked, see OP-N` | `in-review <PR link>` | `done` | `cut <date>: <reason>`.

## 2. Every task ships as a pull request

No exceptions: one-line changes, docs, and your own scaffold task included.

1. Branch from `dev` after claiming. Never from `main`.
2. Commit small. Money logic gets its failing test first
   (`superpowers:test-driven-development`). Other code follows the thin-test rule: one
   meaningful check per change.
3. Run `/ponytail-review`, then `/code-review` at medium. Add `/security-review` when the
   diff touches `packages/chain`, the daemon, keys or transaction building.
4. Run `superpowers:verification-before-completion` before you call it done.
5. Open the PR into `dev`. Fill in every line of the template. Squash-merge.
6. Write the finding you measured into your task row, with its number, the way monad did
   ("146 events became 14,237"). A task that discovered nothing usually did not look.

A second human reviews only what CI cannot see: money math, anything that builds a
transaction or a Swig instruction, the three frozen contracts, and docs another track reads.
CI reviews the rest.

`main` lives in the separate public repo and is written only by the release job. Nothing is ever
merged from `main` back into `dev`. Code moves left to right only.

## 3. Rules for agent sessions

- Ponytail is on at level `full` through the `UserPromptSubmit` hook in
  `.claude/settings.json`. It restates itself every turn. Follow it.
- One agent session per claimed task, in its own worktree
  (`superpowers:using-git-worktrees`). Parallel agents never share a checkout.
- Task longer than a day: `superpowers:brainstorming`, then `superpowers:writing-plans`. The
  plan goes in `docs/plans/` on `dev`, never public. Under a day, skip it.
- CI red or a spike fails: `superpowers:systematic-debugging` before you change any code.
  Find the cause, then write the finding with its number into the task row.
- Hit something only a human can do (a key, funds, outreach, a question for Colosseum)? Write
  an `OP-N` entry in `OPERATOR_TODO.md`, set your task to `blocked, see OP-N`, and move to
  another task. **Never fake a credential, a verification or a measurement to look done.** A
  green row with nothing behind it is worse than an open one.
- Search through the `Explore` subagent. Never paste whole files, logs or JSON into the main
  conversation. One agent per task; multi-agent workflows only when a human asks for one.
- Work is credited to the person who ran the agent. No AI co-author lines in commits.
- You may edit only the files in your task's `Touches:` line. Need a file another task owns? Say
  so in the PR and let that owner change it. This is what keeps the tasks independent.

Default tool per step, so nobody picks from scratch. A tool not in this table is not part of the
default workflow.

| Step | Tool |
|---|---|
| Is this feature worth building? | Colosseum Copilot, conversational; a deep dive costs 20 to 30 API calls |
| Plan a task longer than a day | `superpowers:brainstorming`, then `superpowers:writing-plans` |
| Scope every change | Ponytail, level `full`, always on |
| Set up the workspace | `superpowers:using-git-worktrees` |
| Find code | `Explore` subagent; Graphify once the repo passes about 500 files |
| Library docs (Solana kit, Swig, Jupiter) | Context7, then the vendor docs. Context7 was failing to connect on 2026-09-23, fix before relying on it |
| Guard, decoder or miner code | `superpowers:test-driven-development` |
| Test set for a track | `engineering:testing-strategy`, once per track on day 1 |
| CI red or a spike fails | `superpowers:systematic-debugging` |
| Before opening a PR | `/ponytail-review`, then `/code-review` at medium, plus `/security-review` on chain, daemon, keys or tx building |
| Claiming a task done | `superpowers:verification-before-completion` |
| Decision expensive to reverse | `engineering:architecture`, writes a short ADR |
| Every Friday | `/ponytail-audit` on dev, `/ponytail-debt` into TASKS.md, `engineering:standup` |
| At CP4 | `engineering:tech-debt`, one pass before the fall build |
| Before a production release | `engineering:deploy-checklist`, plus the pre-mainnet checklist when signing changes |

Token rules: `CLAUDE.md` stays under about 60 lines, detail lives in skills that load on demand.
MCP tool responses keep the budgets CI enforces (`get_report` 2,000, `check_trade` 400). Every
Friday each person runs the `explain-usage` skill on one heavy session and records the biggest
waste in the standup.

## 4. Task row format

```
### T-X01, Decode Meteora DLMM swaps
- Status: open
- Depends-on: T-A01
- Touches: packages/decoder/src/venues/meteora.ts, fixtures/golden/
- Serves: Functionality (judged) ; F1 coverage share
- Acceptance: 50/50 sampled Meteora txs match hand ledger; coverage on beta wallet 3 rises above 95%
- Evidence: <link to spikes/F1/result.json at a commit, or the PR>
- Kill criterion: coverage gain under 2 points after 1 day, so cut and list Meteora as unsupported
```

`T-X` on purpose: X is not one of the tracks, so this example can never collide with a real row.
It used to read `T-A03`, which is a real task, and `scripts/board.mjs` reads the whole file when it
checks a `feature/` branch against its row. It found this block first, saw `Status: open`, and
refused the PR for the actual T-A03 with "claim it first" after the claim had already merged.

`Serves:` must name a judged criterion (Functionality, Potential impact, Novelty, UX, Open
source, Business plan) or a measured user metric. `Acceptance:` must contain a number. Both
are linted. A task whose acceptance has no number is not a task, it is a wish.

ID ranges: `T-A` to `T-E` per track, `T-F` feasibility spikes, `T-J` submission deliverables,
`OP-N` operator items.

Tracks: **A** decoder and miner. **B** benchmark, then screener. **C** agent side. **D**
on-chain. **E** product and users.

Every feasibility spike task writes `spikes/F<n>/thresholds.json` from its own `Acceptance:`
line **as its first commit, before the spike runs**, then `result.json` next to it. Changing a
threshold after a run needs a note in the PR saying who changed it and why.

## 5. Priority, and what can run at the same time

Priority is the order to claim in. Tasks in one wave touch disjoint files, so five people or five
agents can hold one each with no coordination beyond this file.

| Wave | When | Parallel-safe set |
|---|---|---|
| P0 | Day 1, 09-24 | T-B01 **first, alone**; then T-C01, T-B02, T-C02, T-C03, T-E01, T-E02 |
| P1 | 09-25 to CP1 | A: T-A01, T-F01a. B: T-B03, T-B10. C: T-C04, T-F03, T-C05, T-F11a. D: T-D01, T-F05a, T-F05b, T-F06a. E: T-E03 |
| P2 | CP1 to CP2 | A: T-A02, T-A03, T-A04, T-A05, T-F01b, T-F02. B: T-F09, T-B04, T-B08. C: T-C06, T-C07, T-C08, T-C12, T-C13, T-F04, T-F11b. D: T-D02, T-D03, T-F05c, T-F06b, T-F07. E: T-E04, T-E05, T-E10, T-E12 |
| P3 | CP2 to CP3 | B: T-B05. C: T-C09. D: T-D04. E: T-E06, T-E07, T-E08, T-E09 |
| P4 | CP3 to 10-11 | T-J01, T-J02, T-J03 |
| P5 | Fall, CP4 to CP6 | T-F08, T-F10, T-F11c, T-B06, T-B07, T-C10, T-D05, T-E11, T-J04 |

Two hard gates from the PRD: **no arming UI until its shape is known** (amended 2026-09-28, see
T-B15 and DECISIONS.md; it read "until F5 and F6 pass"), and **no mainnet transaction until the
pre-mainnet checklist is ticked** (T-D04), which is unchanged.

When a test fails, nobody debates it on the spot. It is logged and decided at the next
checkpoint, one of: keep, fallback, cut, extend once. An undecided test at a checkpoint
defaults to its fallback. The decision goes in the PRD Decisions log the same day.

---

# P0, day 1. Nothing branches until T-B01 lands.

### T-B01, Scaffold the workspace, CI and the board
- Status: blocked, see OP-17
- Depends-on: OP-7
- Touches: package.json, pnpm-workspace.yaml, tsconfig.base.json, apps/, packages/, knip.json, .gitignore, .env.example, vercel.json
- Serves: Functionality (judged) ; unblocks all 5 tracks
- Acceptance: `pnpm install && pnpm gates` green on a clean clone with 1 command and 0 keys; the 10 PRD repo paths exist (apps/web, apps/worker, packages/core, decoder, miner, guard, chain, mcp, cli, spikes, fixtures/golden, benchmark); `knip` fails the build on 1 planted unused export; the secret scan fails on 1 planted fake key; CLI cold start measured and under 300 ms; 3 environments wired with their own keys, preview on every PR push against devnet, staging on every merge to dev against devnet plus mainnet read-only, production on a release tag against mainnet
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/3 merged, gates green from a clean clone in 14 s with 0 keys. The last acceptance clause, 3 wired environments, is OP-17
- Finding: the planted-key run found 0 leaks until the key was randomly generated. gitleaks
  allowlists the AWS documentation example key, so testing the gate with a well known example
  makes a working scan look dead. Regenerated at random it caught 5 of 5 shapes, including a
  Solana base58 secret and a 64-byte keypair array. knip caught 5 scripts the nightly live job
  calls that package.json did not define (spike:f3, f5, f10, f11, benchmark:b), so
  feasibility-live would have failed on a missing binary the first night it ran with keys. CLI
  cold start is 165 ms median on Windows against the 300 ms budget. The environments clause is
  carried by OP-17.
- Kill criterion: none, this blocks everything

### T-C01, Freeze the three contracts in packages/core
- Status: done
- Depends-on: T-B01
- Touches: packages/core/, fixtures/contracts/
- Serves: Functionality (judged) ; 5 tracks in parallel from day 2
- Acceptance: 3 contracts defined exactly once, (1) check_trade input mint/side/size/wallet and output verdict plus reasons each carrying a rule name and a number, (2) report JSON with metrics, rules, exceptions and their cost, coverage share, unsupported transactions, (3) rule spec consuming mint set, cap, window, trigger type, expiry and producing a Swig role plus a Jupiter order id; that 1 definition generates the MCP tool schemas, API validation, frontend types and fixture checks, proven by 1 deliberate shape change failing in all 4 places
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/7
- Kill criterion: none, a frozen contract is why the tracks do not block each other

### T-B02, Release job, dev to the public main by allowlist
- Status: blocked, see OP-7
- Depends-on: T-B01, OP-7
- Touches: .github/workflows/release.yml, .publicinclude, scripts/release.mjs
- Serves: Open source (judged)
- Acceptance: a `release-*` tag on dev copies only allowlisted paths into a clean public checkout, then installs, builds and passes tests on the stripped tree; 0 of 6 planted internal markers survive (TASKS.md, OPERATOR_TODO.md, FEASIBILITY.md, `OP-`, `.claude`, an internal URL); 1-click web rollback documented; releases run at least 1 per day during a hackathon
- Evidence: <link to the first release run, blocked on OP-7>
- Finding: 2 of the 3 release legs were dead on arrival and nothing said so, because the job had
  never been run. The stripped tree failed `pnpm build` with TS5083 on a missing tsconfig.json and
  failed `pnpm test` with "No test files found, exiting with code 1": .publicinclude allowlisted
  tsconfig.base.json but not tsconfig.json, and not vitest.config.ts, so the 9 project references
  and the 3 passWithNoTests projects both vanished from the public tree. 2 allowlist lines fixed
  the build leg. The marker gate was the T-B01 trap again, a gate quiet on a clean tree and never
  proven to bite: neutering findInternalMarkers now fails 6 of the 9 cases in
  scripts/release.test.mjs, so the 6 planted markers are measured and not assumed. Also
  .publicinclude promised .github/workflows/public-ci.yml, which did not exist, so the public repo
  would have shipped with 0 CI next to a README that calls tests the evidence. The sharpest one
  came from reviewing the fix: CHANGELOG-latest.md is built from dev's commit subjects during
  --push, after --check has already passed, and PR #9 is open titled "Write the measured provider
  limits into OP-2, OP-3 and OP-4", so the next release would have published an OP- marker through
  the 1 file the gate never saw. A gate that runs at the wrong moment is worth the same as a gate
  that does not run. Third dead gate, same shape: every package's dist/ and tsconfig.tsbuildinfo
  were published, and a published tsbuildinfo tells `tsc -b` on the stripped tree that all 9
  projects are already up to date, so the step whose only job is proving the public tree compiles
  compiled nothing and passed. `tsc -b --dry` said "is up to date" for 9 of 9 before the fix and
  "a non-dry build would build" for 9 of 9 after it. The exclusion has to run inside cpSync and not
  only on the glob, because `apps/**` yields `apps/web` itself and a recursive copy of a directory
  carries whatever is in it. Then the gate earned itself inside an hour: rebasing onto the dev that
  had just taken T-C01 and T-C02, it found 5 live `OP-<n>` references in published source, 1 of
  them in a string printed to whoever runs the recorder. It also found that the published suite
  failed 6 of 17 on ENOENT because fixtures/ was not allowlisted, which is worse than shipping no
  tests: it tells a judge who cloned the repo that the code is broken. All 3 legs now pass end to
  end, 0 of 6 markers and 17 of 17 tests on the stripped tree. Only the push is unproven, on OP-7.
- Kill criterion: none, judges only see the public repo

### T-C02, Record and replay wrapper with per-call timings
- Status: blocked, see OP-1
- Depends-on: T-B01
- Touches: packages/core/src/net/, fixtures/recorded/
- Serves: Functionality (judged) ; Benchmark B latency breakdown
- Acceptance: 1 wrapper around all 5 external calls (Helius, Jupiter, RPC, RugCheck, Jev); recorded responses for the golden wallets and about 30 tokens, every file stamped with its source slot or `synthetic: true`; the whole offline suite runs with 0 keys and 0 network access, verified with the network blocked; every call logs its duration from the first request
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/11 merged, 43 fixtures across 4 providers, suite green with fetch stubbed to throw and 0 keys set. Golden-wallet recordings need OP-1
- Kill criterion: if C slips past day 2 this moves to B, per the PRD load check

### T-C03, Measure the region for API, RPC and Jev
- Status: done
- Depends-on: T-B01
- Touches: docs/plans/region.md, apps/web/vercel.json
- Serves: Functionality (judged) ; decision speed
- Acceptance: p50 and p95 round trip measured from at least 2 candidate regions to the Helius RPC node and the Jev endpoint, 100 calls each; the chosen region is set in config and both numbers are written down
- Evidence: docs/plans/region.md, plus the region 2 run
  https://github.com/manjeetsharma0796/agon-dev/actions/runs/35996972613
- Finding: deploying near our users is the wrong instinct by 5.8x. Helius p50 is 136.3 ms from
  India against 23.5 ms from the US, p95 267.5 against 39.6, and the Cloudflare edge that Workers
  AI runs on is 210.8 ms against 12.9 ms, a 16.3x gap. A 2,000 transaction report is 20 sequential
  history calls, so that is 2.7 s of pure network from India against 0.5 s from the US, paid before
  anything is decoded, while the distance to the user is paid once. Second finding, about method:
  the CI probe cannot carry a key (OP-2), so the unkeyed 401 was checked against the keyed call on
  the same machine before it was trusted, 140.4 against 136.3 p50, inside 3 percent. Third: the
  first Cloudflare probe read 442.2 ms and was wrong, because api.cloudflare.com is the control
  plane and is not served from the nearest colo, 2.1x the real edge number. A probe that looks
  reasonable and measures the wrong machine is worth less than no probe.
- Kill criterion: none, it is a setting and not code, so it is measured once and cheap

### T-E01, Demo script and the committed benchmark scenario list
- Status: done
- Depends-on: none
- Touches: docs/demo-script.md, benchmark/scenarios/
- Serves: UX (judged) ; Functionality (judged)
- Acceptance: a 3-minute script with every beat timed; 100 scenarios written and committed before the first benchmark run, split 40 normal trades inside the profile, 30 dangerous tokens (live freeze authority, permanent delegate, no sell route), 30 rule breaks (4x usual size, past usual stop, prompt injection); the commit hash recorded for the published posts
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/8, benchmark/scenarios/scenarios.json, 100 scenarios split 40/30/30
- Kill criterion: none. Anything not in the script is a candidate to cut at each checkpoint

### T-E02, Beta waitlist live
- Status: blocked, see OP-18
- Depends-on: T-B01
- Touches: apps/web/app/waitlist/
- Serves: Business plan (judged) ; CP3 gate needs 10+ reports
- Acceptance: live URL collecting an email and a Solana address with 0 login; 1 confirmation email; recruiting starts the same day, because it is the slowest part of CP3
- Evidence: <live URL, plus the first 5 signups, blocked on OP-18>
- Finding: hand-rolled base58 got the System Program address wrong, and it is the exact shape of
  bug that would have looked like a working validator. Decoding the leading '1's as digits and then
  adding 1 zero byte for each of them counts every one twice, so 11111111111111111111111111111111
  decoded to 33 bytes instead of 32 and a real address was rejected as malformed. It was caught by
  testing against 6 real mainnet addresses instead of invented ones; 5 of the 6 passed either way,
  because only the 2 with leading zero bytes exercise that path. Second: an address has no
  checksum, so shape is the only thing that can be rejected and a typo decoding to 32 bytes is
  indistinguishable from a real address, which is why the confirmation email is the real check and
  not decoration. Third: the form refuses to pretend while it has no endpoint, because a waitlist
  that silently drops a signup is the one failure recruiting cannot recover from.
- Kill criterion: none, CP3 cannot pass without a cohort

---

# P1, day 2 to CP1 (2026-09-27)

CP1 evidence required: F1 on 2 wallets; F3; F5 on devnet; F6 in simulation; F11 access, schema
and latency (a, b).

### T-E03, Thin end-to-end version on staging
- Finding 2: a server fault was reported as the caller's. Deleting `fixtures/contracts/` and
  asking for a report on a valid address answered "That is not a valid Solana address." with a
  400, and the real cause sat in `detail` where nothing reads it. A beta user would have gone and
  checked their wallet while the server was the thing that was broken. `badRequest` caught
  everything and blamed the caller for all of it. It now splits: a zod failure or an unparseable
  body is a 400, anything else is a 500 that says the problem is not what you sent. Splitting on
  zod alone sent "the request body is not JSON" to a 500, which the existing test caught, so
  unparseable bodies throw a marked error rather than a plain one
- Finding: the web app could not be started by a host. `apps/web` had `dev` and `start` and no
  `build`, and `next start` without a prior `next build` exits on "Could not find a production
  build in the '.next' directory". Nothing caught it because the root `build` is `tsc -b`, which
  type checks the app and never builds it, so `pnpm gates` passes on a tree that cannot be
  deployed. Measured by deleting `.next` and starting: the process comes up, logs that error and
  serves nothing, so a host's health check is what would have found it, in staging
- Status: blocked, see OP-17 | Branch: feature/t-e03-web-build
- Depends-on: T-C01, T-C02
- Touches: apps/web/app/report/, apps/web/app/api/, packages/mcp/src/index.ts, Dockerfile
- Serves: Functionality (judged) ; UX (judged)
- Acceptance: on staging, pasting an address returns a report built from fixtures, `check_trade`
  returns a fixture verdict, and arming is a no-op on devnet; all 3 legs work end to end by day 2,
  so integration bugs show on day 2 and not day 18
- Evidence: <staging URL, plus the 3 legs in a recording>
- Kill criterion: none. Monad's worst bugs only appeared end to end (T1.7, T6.8)

### T-A01, Balance-change decoder
- Status: done
- Depends-on: T-C01, T-C02
- Touches: packages/decoder/src/
- Serves: Functionality (judged) ; F1
- Acceptance: every transaction is classified buy, sell or not-a-swap from pre/post token
  balances with amounts exact to base units; 0 silent drops, every undecoded transaction listed
  with a named reason and a program id; runs as pure functions with 0 network calls inside
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/23, 5 real mainnet transactions replayed offline. The golden-wallet regression run needs OP-1
- Finding: transactions taken from AMM pool activity are router and MEV flow, not retail swaps. The
  fee payer was the trader in 0 of 5, and each transaction had 2 to 4 separate owners with
  two-sided balance movement, so the wallet has to be named rather than derived: decoding the
  wrong owner returns a confident wrong answer instead of an error. Separately, 3 of the first 4
  transactions pinned were SOL to USDC, both sides quote assets. Classifying those as undecoded
  would have put the most common shape on the chain into the unsupported list and deflated
  coverage on transactions we read perfectly well, so they are not-a-swap with a stated reason and
  do not count against coverage.
- Kill criterion: none, F1 is existential
- Finding: the coverage number can lie. deltas() reads only meta.pre/postTokenBalances, and nothing in packages/ reads meta.pre/postBalances, so a swap paid in native SOL is invisible: the wSOL account is opened and closed inside the same transaction and appears in neither array. It returns not-a-swap "value only arrived the wallet", which carries no program id, is absent from unsupported, and is excluded from totalSwaps, so a wallet trading from native SOL reports 100% coverage while decoding none of its swaps. Two smaller ones: topProgram returns the first instruction with a programId, which on every real mainnet transaction is ComputeBudget, so all undecoded transactions collapse into one unsupported row named ComputeBudget; and decodeAll keeps only the first reason per program id. Fix is T-A07.
### T-A07, Decode swaps paid in native SOL
- Evidence: re-running spikes/F1 moved 5CKAa7Wm's 50 sampled transactions from 50 identical
  "value only arrived the wallet" to 9 rotations, 40 one-sided and 1 the other way, with 0 silent
  drops, and moved 5Q544fKr's unsupported row from ComputeBudget to JUP6LkbZ. 5 tests, 1 per
  clause, each failing before the fix. 5Q544fKr stayed at 29 swaps of 50, which is the check that
  matters: a native leg added to a swap already read from token balances must change nothing
- Finding: lamports are not a second mint, they are the same asset as wSOL, and adding them as a
  separate one turns a wrap into a swap of SOL for SOL. Netting both into 1 mint is what makes
  wrapping silent, which is correct, because wrapping is not a trade
- Finding 2: the first rent rule cost 2 good decodes. Adding back the rent of every account opened
  or closed anywhere in the transaction attributes other parties' accounts to this wallet, and on
  5Q544fKr it turned 1 swap into ambiguous and 1 rotation into one-sided, both on transactions
  whose lamport delta was 0. Scoped to token accounts this wallet owns, it changed 0 of the 100
  sampled transactions, so it is reasoned rather than measured: an account opened and closed in the
  same transaction needs no correction at all, because the rent left this balance and came back
- Finding 3: T-A07's last clause cannot pass as written, and the decoder is not why. All 50 of
  5CKAa7Wm's sampled transactions are arbitrage: token gains of 3840 lamports and 0.007 USDC
  against a fee of the same order. The decoder now names every one of them correctly and the swap
  count is still 0, because there are no swaps in them. Written up as OP-31
- Finding 4: this fix does not reach production on its own. The product reads a wallet's history
  from Helius's enhanced endpoint, and fromEnhanced carries only tokenBalanceChanges across, so the
  native leg is dropped at the edge before the decoder ever sees it. packages/decoder/src/enhanced.ts
  is not on this task's Touches line, so it is T-A08
- Status: blocked, see OP-31
- Depends-on: T-A01
- Touches: packages/decoder/src/index.ts, packages/decoder/src/decoder.test.ts
- Serves: Functionality (judged) ; F1 coverage share
- Acceptance: a swap whose quote leg is native SOL decodes as buy or sell rather than not-a-swap,
  read from meta.pre/postBalances net of meta.fee and of rent for an account opened or closed in the
  same transaction; 1 hand-built native-SOL buy and 1 sell asserted in decoder.test.ts; an undecoded
  transaction names the venue program rather than ComputeBudget on all 5 recorded fixtures; decodeAll
  keeps every distinct reason per program id, not just the first; the 50 sampled transactions of
  wallet 5CKAa7Wm in spikes/F1 stop reporting 0 swaps at 100% coverage
- Kill criterion: none. A coverage number computed over silently dropped swaps is the failure the
  third bucket exists to prevent, and F1 is existential

### T-A08, Carry the native SOL leg across the enhanced endpoint
- Status: done 2026-09-29 | Owner: Jishnu | PR: #181
- Depends-on: T-A07
- Touches: packages/decoder/src/enhanced.ts, packages/decoder/src/decoder.test.ts,
  fixtures/recorded/native-leg/, packages/cli/src/commands/report.test.ts
- Serves: Functionality (judged) ; F1 coverage share
- Acceptance: fromEnhanced carries nativeBalanceChange and the fee across, so a swap paid in native
  SOL decodes the same whether it arrived from getTransaction or from the enhanced endpoint; 1
  recorded enhanced transaction with a native leg asserted against the getTransaction decode of the
  same signature, field by field
- Evidence: 1 real mainnet buy recorded in both shapes on 2026-09-29, `p1MyCSqP...` at slot
  451494158, a pump.fun token bought for 502806022 lamports paid from native SOL, in
  `fixtures/recorded/native-leg/`, key redacted. Before: the enhanced shape decoded it as
  not-a-swap while getTransaction decoded a buy. After: the 2 decodes are equal field by field,
  soldAmount 502806022 on both, which is the lamport change 505434862 net of the 1115000 fee and
  the 1513840 rent of the token account it opened. The test failed first. The 30 enhanced accounts
  arrive in the transaction's own order, all 30 checked against the raw keys, which is what lets the
  rent rule find the account it opened
- Finding: it changes 0 of the 100 recorded transactions of the wallet `check_trade` serves today:
  every swap in it already moves through wSOL token accounts. The fix matters for retail wallets
  paying from native SOL, which is the pump.fun buyer this was found on: 60 recent BONK
  transactions held 0 swaps that depended on the native leg, and the pump.fun program's did
- Finding 2: mainnet now carries version 1 transactions. A getTransaction with
  `maxSupportedTransactionVersion: 0` is refused on them with "Transaction version (1) is not
  supported". Nothing in the product calls getTransaction for history, but any recorder that does
  will skip them
- Kill criterion: none. T-A07 fixed the decoder and the product does not use the shape it fixed, so
  until this lands the coverage number a user sees is the old one

### T-A06, Fix the two coverage numbers that can lie
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/134. Re-running spikes/F1 moved
  5CKAa7Wm from `share 1` to `share 0` and 5Q544fKr from 0.9666666666666667 to 0.58, which is
  29 of the 50 sampled, exactly the 2 numbers the acceptance predicted. 4 tests, 1 per defect,
  each failing before the fix
- Finding: removing the signature tie-break was not enough on its own, and the test caught it. With
  no tie-break the order the swaps arrive in decides the answer instead, so a same-slot sell that
  arrived first still invented a sold-more-than-held against units the wallet demonstrably held.
  Within 1 slot there is no ordering available to us: the block has one and a decoded balance
  change does not carry it. So the tie is broken on the only thing knowable and economically
  meaningful, which is that a wallet cannot sell units it acquired in the same slot unless the buy
  is counted first. That exception is subtracted from realised P&L, so the conservative order is
  also the accurate one
- Finding 2: the old denominator could not fall below the 95% the PRD treats as a finding, however
  little was understood, because it dropped from the count exactly what the decoder had chosen not
  to explain. 2 existing tests asserted that shape and were updated with their reasons rather than
  their numbers: a rotation and a transfer both count in the denominator now, for different
  reasons, because the share answers "how much of what we saw did we explain" rather than "how much
  of what we already agreed was a swap"
- Finding 3: writing the empty-wallet fixture the frozen-contract gate asks for found a third
  number of the same family, left alone because it is a different contract: Metrics makes
  medianSize and medianHoldSeconds required and not nullable, so a wallet with 0 closed trades has
  to report a median of 0, which reads as a measured fact rather than as nothing to measure. Needs
  its own task, because widening 2 fields to nullable moves every consumer of Metrics
- Status: done
- Depends-on: T-A01
- Touches: packages/decoder/src/index.ts, packages/core/src/report.ts, packages/decoder/src/pnl.ts
- Serves: Functionality (judged) ; F1 coverage share
- Acceptance: a wallet with 0 decoded swaps reports coverage share 0 rather than 1, and the frozen
  Coverage contract stops exempting totalSwaps === 0 from its own consistency check; totalSwaps
  counts every transaction the wallet was a party to rather than excluding not-a-swap, so the share
  can actually fall below the 95% the PRD treats as a finding; re-running spikes/F1 changes
  5CKAa7Wm from 100% to 0% and 5Q544fKr from 96.7% to the share over all 50 sampled; and fifoLedger
  stops tie-breaking same-slot swaps on the base58 signature, with 1 test asserting a same-slot buy
  and sell produce 1 closed trade whichever order they are passed in
- Kill criterion: none. A coverage number that reads 100% when nothing decoded is the single defect
  positioned to turn a real run green, and it is live today in spikes/F1/result.json
### T-D06, Verify the cap that is on chain, not the one we meant to send
- Status: done
- Depends-on: T-D01
- Touches: packages/chain/src/swig/index.ts, packages/chain/src/swig/real-cap.test.ts,
  packages/chain/src/expiry.test.ts, packages/cli/src/commands/revoke.test.ts, and NOT
  packages/chain/src/kill-switch.ts, which this line claimed and the work never needed
- Serves: Novelty (judged) ; the custody claim
- Acceptance: assertAgentRoleShape reads the configured recurring amount rather than the remaining
  allowance, so a role with a spent window still verifies and the kill switch removes it, asserted
  by a test that zeroes currentAmount and still expects revocation; the program permission is
  checked as Permission.Program with the pinned Jupiter id rather than through canUseProgram, so a
  role carrying programAll is REJECTED, asserted by a test building exactly that role; the approved
  cap amount and window are passed in and compared, so a role armed at 25,000 when the user signed
  25 is rejected; 0 of these tests pass against the current code before the fix
- Evidence: PR link below, 6 tests in packages/chain/src/swig/real-cap.test.ts, 253 passing across
  36 files. The 3 required controls failed against the old code before the fix, plus 3 more the
  reviews demanded. The spent-window case forges a real role by zeroing currentAmount in the encoded
  bytes rather than stubbing one, with both candidate offsets probed to confirm which field is which
- Kill criterion: none. This is the layer that assumes every layer above it failed
- Correction 2026-09-25, after the fact: this `Touches:` line was wrong while the work was done and
  is fixed above rather than left to mislead. The row was worked on 2 files it did not claim, one of
  them `packages/cli/src/commands/revoke.test.ts`, which belongs to Track C, and that is exactly the
  collision `Touches:` exists to prevent. It was not noticed at the time because widening the shape
  check's `RoleActions` interface broke every hand-rolled stub of it, and the stubs live wherever
  their own package's tests live. Worth knowing for anyone widening a shared interface: the blast
  radius is every fake of it, not only the file you set out to change. It also claimed
  `kill-switch.ts`, which never needed an edit: the fail-open there was cured entirely by fixing the
  shape check it delegates to, which is what "sharing the definition" in that file was for
- Finding: the fix almost shipped the same fail-open through a different door, which is the finding
  worth keeping. Reading the CONFIGURED cap needs the token action before the program action in the
  buffer, because `Actions.tokenSpend` does `find(a => a.tokenControl(mint).spendLimit != null)` and
  `spendLimit` returns `0n` rather than `null` for an action with no token control, so the program
  action always matched first and its empty controller came back. Requiring a readable cap in the
  shape check therefore rejected every role armed program-first, which is every role the previous
  code produced, and the kill switch would have reported "No Agon roles were found" for all of them
  from the moment it shipped. The rule now written into the file: **the revoke path is never
  stricter than the arm path**, or it cannot clean up what arming produced. Identity is checked
  order-independently; the cap is compared only where an approved number exists to compare it to.
  Also: `canUseProgram` cannot prove scoping, only a negative probe can, and the bypasses ruled out
  are ProgramCurated and All (answer yes to the probe), ProgramScope and SubAccount (answer no to
  Jupiter), and non-recurring TokenLimit (no recurringAmount). Left open for T-E06: `approved` is
  optional because the kill switch cannot supply it, so an arming call that omits it silently skips
  the cap comparison. T-E06 must pass it, and a test should assert the 1000x role is refused

### T-F01a, F1 spike on 2 wallets, for CP1
- Status: blocked, see OP-23
- Depends-on: T-A01
- Touches: spikes/F1/, scripts/board.mjs
- Serves: Functionality (judged) ; CP1 gate
- Acceptance: on 2 wallets, 50 of 50 randomly sampled transactions classified correctly, amounts
  exact to base units, realised P&L within 1% of a hand-computed FIFO ledger; share of swaps
  decoded recorded per wallet, below 95% is a checkpoint finding and not a pass
- Evidence: <spikes/F1/result.json at a commit>
- Kill criterion: fallback is Jupiter-routed swaps only, with the covered share printed on the report ("based on 83% of your swaps")

### T-C04, Our own mint check
- Status: done
- Depends-on: T-C01, T-C02
- Touches: packages/guard/src/mint-check.ts
- Serves: Functionality (judged) ; F3
- Acceptance: mint authority, freeze authority and Token-2022 extensions (permanent delegate,
  transfer hook, transfer fee) read in exactly 1 `getMultipleAccounts` call; mint and freeze
  authority are never cached; RugCheck is enrichment only and is never on the deciding path; an
  unreachable RPC returns `block` with "Couldn't verify this token. Not safe to proceed."
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/26, 30 mints in 1 call at slot 450012073, 6 block and 24 pass
- Finding: the extension being present is not the danger being present. 5 of the 30 recorded mints,
  17 percent, carry the Token-2022 `transferHook` extension with `programId: null`, which means no
  hook is installed. A check that treats the extension list as the finding blocks 5 real tokens for
  something none of them does, and it would have looked like a working safety check while doing it.
  Second: the 4 mints with a permanent delegate are a subset of the 6 with freeze authority, so the
  block set over this sample is 6 and not 10, and a check that counted traits rather than mints
  would have reported 10. Third: a live mint authority must not block. 8 of 30 have one, USDC
  included, so blocking on it refuses most of what people actually trade; it dilutes, it does not
  seize, so it is reported. Fourth: Token-2022 carries 2 scheduled transfer fees and which one
  applies depends on the current epoch, which the mint account does not carry and which
  `getEpochInfo` would cost a second call to learn, against a budget of exactly 1. So the worse of
  the 2 is reported: overstating a fee costs the user nothing and understating it costs them the
  difference. 30 mints, 1 `getMultipleAccounts`, 6 block and 24 pass at slot 450012073.
- Kill criterion: none, this is the primary path

### T-F03, F3 spike, token risk check on 30 labelled mints
- Status: done
- Depends-on: T-C04
- Touches: spikes/F3/
- Serves: Functionality (judged) ; CP1 gate
- Acceptance: our own check flags all 20 dangerous mints (10 with live freeze or mint authority,
  10 Token-2022 with permanent delegate, transfer hook or transfer fee) and 0 of the 10 blue chips
- Evidence: spikes/F3/result.json at a commit, measured at slot 450037708
- Finding: FAIL, 10 of 20 dangerous flagged and 2 of 10 blue chips flagged, and neither miss is a
  bug in the code. The 2 blue chips are USDC and USDT, flagged for a live freeze authority, which
  is the same trait the dangerous set is labelled by, so 1 rule cannot both disqualify that trait
  and wave through the 2 largest stablecoins on Solana. The tokens carrying it say why: PYUSD is
  PayPal, USDG is Paxos, cbBTC is Coinbase, and SPYx, NVDAx and GLDx are tokenised equities and
  gold, where a freeze authority and a permanent delegate are how a regulated issuer meets a court
  order. The other 10 misses are fee-only Token-2022 mints, deliberately reported and not blocked,
  because a 3% fee is a cost the size rule can price and not a way to take the position. 2 more
  from the real distribution: 0 of the top 100 mints by organic score has a live transfer hook,
  every `transferHook` extension found had `programId: null`, so the third danger the acceptance
  names does not occur at this end of the market; and 8 of the 10 authority-group mints also carry
  a permanent delegate, so the 2 disjoint groups of 10 the acceptance imagines are 1 overlapping
  group on chain. The threshold is what needs the decision at CP1, not the check.
- Kill criterion: RugCheck stays optional either way; a miss on the 20 is a bug to fix, not a scope cut

### T-C05, Jev client, question schema and the injection screen
- Status: done
- Depends-on: T-C01, T-C02
- Touches: packages/guard/src/jev/
- Serves: Novelty (judged) ; F11
- Acceptance: 1 batched call carries the whole non-numeric question set, exactly 3 question
  kinds (token category as a 6-way choice, impersonation, injection screen over all outside
  text); 0 numeric questions can reach Jev, enforced by a type that rejects them and a test
  proving it; token category cached forever and globally per mint, metadata for minutes; a
  "looks injected" flag blocks; the answer carries its data slot and rule version
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/27, plus the control run: widening
  JevQuestion to admit a numeric kind fails typecheck with TS2578, so the guard is the build
- Finding: the endpoint takes 3 question types, choice, score and noul, and 2 of them return a
  number. Using score or noul would smuggle a number back out of Jev, which is the thing this task
  exists to prevent, so all 3 questions are choice with named criteria. noul does not discriminate
  at all: 0.005 for obvious marketing blob against 0.006 for a concrete trade instruction, and
  0.0046 to 0.0222 across 5 unrelated questions about the same text. A question wired to noul would
  have returned a near-zero every time and read as a confident no
- Kill criterion: fallback is an LLM guard in structured-output mode with a stricter threshold, or Kev-0.5B locally. Arithmetic checks are unaffected either way
- Finding: the metadata cache in the acceptance does not exist. Token category is cached forever and globally as specified, and mint and freeze authority are correctly never cached, but no minutes-scoped metadata cache exists anywhere in the repo: categoryCache is the only cache in the tree. Separately JevTransport takes body: unknown, so the "no numeric question can reach Jev" guarantee holds for the ask() path only; anything holding a transport can call it with a hand-built score payload.
### T-F11a, F11 (a) and (b), Jev schema validity and latency
- Status: done 2026-09-29 | Owner: Jishnu | PR: #210
- Depends-on: T-C05, OP-4
- Touches: spikes/F11/, FEASIBILITY.md
- Serves: Novelty (judged) ; CP1 gate
- Acceptance: 500 of 500 responses valid against our question schema; latency at 1, 5 and 20
  questions per call, 200 calls each, with p95 at 20 questions 500 ms or less and 20-question p95
  within 1.5x of 1-question p95
- Evidence: `spikes/F11/result.json`, live against TypeSafe direct (OP-4) on 2026-09-29: 600 of
  600 responses valid against the schema in `thresholds.json`, 200 calls at each of 1, 5 and 20
  questions per call. p50 262 ms at every size; p95 324 ms at 1, 294 ms at 5, 341 ms at 20, so
  20-question p95 is 1.05x the 1-question p95 against a 1.5x limit and 341 ms against 500 ms. The
  run's `commit` field names the working tree it ran from, whose runner is the one committed here
- Finding: batching is close to free. 20 questions in 1 call cost 1.05x the latency of 1, so every
  text a check needs screened should ride in 1 call, and OP-24's "most efficient batching" answer is
  as many questions per call as the trade needs, at least up to 20
- Finding 2, the rate limit OP-4 asked for: sending 1 call at a time, about 4 a second at 262 ms
  each, drew 167 answers of 429 across the 600 calls, all retried after a pause. So the limit sits
  below about 4 requests a second on this key, and a production check must not fire per-token calls
  in parallel. Cost: 155865 input tokens for the 600 calls, which T-F11c prices
- Not measured here: accuracy. These texts are real token names only; T-F11b's labelled and
  adversarial cases are what OP-38 waits on
- Kill criterion: fallback is an LLM guard with a stricter threshold, or Kev-0.5B locally

### T-D01, Swig role creation and removal in packages/chain
- Status: done
- Depends-on: T-C01
- Touches: packages/chain/src/swig/
- Serves: Novelty (judged) ; F5
- Acceptance: creates a role with `program = Jupiter` and `tokenRecurringLimit` and nothing
  else; the agent key holds 0 `manageAuthority`, verified by reading the role on-chain and not
  from our config; Swig and Jupiter program ids pinned in config, 0 read from user input;
  transactions built as v1 with `@solana/kit` ^2.1.0, which is what every published Swig package
  pins (amended 2026-09-24 by Jishnu, see the T-D01 finding: 8.0.0 was unreachable)
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/39, role shape and the no-manageAuthority
  check with 4 negative controls. The on-chain round trip belongs to T-F05a
- Finding: the last acceptance clause cannot be met. It asks for transactions built with
  `@solana/kit` 8.0.0 or later, and every Swig package at every published version pins
  `@solana/kit ^2.1.0`: classic, lib and coder, 20 versions each. Installing both puts 2
  incompatible copies of kit in the tree (2.3.0 and 8.3.0) whose branded Address and Instruction
  types do not interoperate. This is a CP1 decision, not a refactor: either the clause moves to
  ^2.1.0, which is what the only available SDK supports, or the Swig instructions get built by hand
  against the coder to decouple from its kit version
- Kill criterion: none. If the cap does not hold on-chain the custody story is gone, see T-F05a
- Finding: two ways the cap reads as holding when it does not. (1) tokenSpendLimit returns the REMAINING allowance, not the configured cap, so a role whose window is spent reads 0 and assertAgentRoleShape throws "carries no spending limit"; kill-switch isAgentRole swallows that, planRevokeAll files the role under kept as "not ours to remove", and revokedMessage reports "No Agon roles were found". The emergency stop fails open on exactly the role that has been trading hardest, and Swig resets the window afterwards. (2) canUseProgram returns true unconditionally under ProgramAll, and the SDK silently appends programAll to any action set with no program action, so a stored role of programAll plus tokenRecurringLimit has count 2 and is ACCEPTED as "program = Jupiter". Also the approved cap AMOUNT is never compared to what the user signed, only that a limit exists, and the window is never checked beyond being positive. Fix is T-D06.
### T-F05a, F5 spike, 7 cases on a mainnet fork
- Evidence 2026-09-29: 5 of 7 pass on a local fork, up from 2. (a) 0.1 wSOL through Raydium CLMM,
  the wallet paid exactly 100000000 base units, received 11885799 USDC against a quote of
  11887909, allowance 500000000 to 400000000. (b) 0.45 with 400000000 left, refused by the Swig
  program with balances unchanged, and the control at 0.35 landed through the same venue inside
  the same window. (d) now passes against the sentence OP-28 decided. (e) reports "not run" and
  (g) needs a person
- Evidence 2026-09-29, later: 6 of 7 on a local fork, `spikes/F5/result.json` at slot 451560606.
  (a), (b), (c), (d) and (f) as before, (c) now passing only because Swig itself refused. (e)
  passes for the first time: lastReset 451560600, window 150, the control verified at 400000000 to
  50000000 left, 2 refusals of 0.1 wSOL by Swig up to slot 451560740, first landing at 451560757.
  (g) needs a person with Phantom
- Finding 13: 1 earlier run showed a 0.1 probe landing 16 slots before the boundary with, on paper,
  0.05 left, which would have been the cap letting through more than its allowance. The spike had
  checked only that the 0.35 control was sent, never that it spent. It now requires the allowance
  to fall by exactly 350000000, and (e) runs only when less than 0.1 is left. The run that
  followed passed. The earlier landing is most likely an unspent control, which cannot be proved
  after the fact, and is recorded here rather than dropped
- Finding 14: Swig's source (`state/src/action/token_recurring_limit.rs`) resets the allowance only
  when `current_slot - last_reset > window`, and sets `last_reset` to the window start only at that
  reset, not on every spend. So the first slot a spend can refill is lastReset + window + 1, which
  `effectiveRemaining` in `packages/chain` already matches. On the fork the Clock the program reads
  runs 31 slots ahead of a finalized `getSlot` and 1 ahead of a confirmed one, so any "when does it
  refill" arithmetic must read slots at confirmed or processed, which the product does
- Finding 15: case (e)'s probe went through 3 designs. 0.45 through Raydium and 0.45 through an
  untouched Whirlpool pool were both refused by the pool; 0.1 through the pool (a) had used is what
  made the answer Swig's. And the fork's upstream failed 7 of about 12 runs today on fetching
  accounts, so a CI version of F5 needs retries around the setup, never around the cases
- Finding 11: case (c) could pass on a refusal no program made. On a fork whose upstream timed out,
  "Failed to fetch accounts from remote" was reported as (c) passing: the check was a list of wrong
  reasons, and the list missed this one. (c) now passes only when the innermost failing program is
  Swig, the same rule (b) and (e) use. On the 3 runs since, (c) was refused by Swig with `0xbbe`
- Finding 12: (e) now probes through Orca Whirlpool, a pool nothing earlier in the run touches,
  because a refused probe changes no state and so cannot move that pool between the 2 probes. Not
  yet measured: on 4 runs on 2026-09-29, 2 forks upstreamed to Helius and 2 to the public mainnet
  RPC, the transaction creating the vault's token accounts failed with "Failed to fetch accounts
  from remote" exactly 30 seconds after the previous step, so (a), (b) and (e) never started. The
  same step had passed earlier that day. Both providers fail the same way and answer directly, so
  it is the fork's fetch on that transaction, not a provider. The committed `result.json` stays the
  5 of 7 run rather than being replaced by a run that measured the fork instead of the cap. A 5th
  run on the public-RPC fork first failed on my own setup, the websocket port left unmapped, and
  is not counted
- Finding 7: the control nearly proved nothing and the fix is a window check, not more care. A
  recurring limit resets on the slot clock, `lastReset = floor(slot / window) * window`, so 3
  swaps sent back to back can straddle a boundary and the control then draws on a fresh allowance
  while looking like it fits the old one. The case now asserts `lastReset` is unchanged across
  (a), (b) and the control, and downgrades (b) to "not run" when it is not
- Finding 8: exact amounts cannot be asserted and it took 3 runs to see why. The fork copies a
  pool on first touch and keeps that copy, while Jupiter quotes the live pool, so received drifts
  below quoted by more the longer the fork runs and the more we have traded it. First run 11891519
  received against 11891519 quoted, exact; the next 11885799 against 11887909. The case asserts
  the slippage floor and that the wallet's input fell by exactly what was sent, which held every
  time
- Finding 9: case (e) cannot be measured after the other 3. Its boundary probe was answered by
  Raydium rather than Swig, because by then our own swaps had moved the fork's copy of the pool
  out of tolerance. It reports "not run" rather than guessing, for the same reason (b) does. A
  spike that asserts the reset slot needs a fresh pool per probe, or a fresh fork
- Finding 10: 2 of the 3 runs failed on infrastructure rather than on the cases, and neither
  failure was about Swig. The payer is funded 1 SOL by the faucet loop, which covered the 6 cases
  that move nothing and not 0.9 wSOL of swaps plus 2 token accounts at 2039280 lamports of rent
  each; and the agent had no lamports of its own once it became the fee payer. Both are now funded
  explicitly, the agent by the owner and with fee money only, so every lamport it could trade with
  sits in the vault behind the cap
- Finding 6, from probing (a) on a live fork: **Swig authorises a Jupiter swap through the capped
  role.** The wrapped instruction reaches Jupiter, `Program swigypWHEksb... invoke [1] Program
  JUP6LkbZ...`, and comes back with `custom program error: 0x1789`, which is a Jupiter error and
  not a Swig one. Authorisation is not the blocker for (a), (b) and (e); token account setup is.
  Two things were learned on the way. Wrapping the whole route is refused with 0xbbe, correctly,
  because Jupiter's transaction carries ComputeBudget, associated-token and Token instructions and
  the role permits only Jupiter, so only the swap instruction may go through the role and the rest
  is the caller's job. And that rest cannot be sent by the payer as Jupiter emits it: Jupiter
  builds its setup expecting the user to sign, a Swig wallet is a PDA that cannot, and every
  attempt to send it payer-signed fails signature verification.
  So the open question for (a), (b) and (e) is not the cap, it is who creates and funds the wallet's
  token accounts and when. In production that is arm time, which makes it T-E06 and T-C08 work
  rather than something the spike invents for itself
- Finding 5: 3 cases now run and 2 pass, the first real F5 measurements. (c) a system transfer out
  of the Swig wallet to an arbitrary address is refused by the Swig program itself, `custom program
  error: 0xbbe`. (f) root removes the role, it stops reading back on the account, and the next
  agent transaction is refused. (d) fails: a memo instruction, 0 accounts and no value moved, is
  authorised under the same role. Read with (c) that says the program limit gates value movement
  rather than every CPI, which is coherent but is not what the acceptance says, so it is OP-28
  rather than a quiet rewording.
  The first version of (c) was a false pass and is worth recording as its own lesson: it built the
  transfer from `swigAccount.address`, which holds the roles, rather than the wallet PDA, which
  holds the funds. The system program refused it for a missing signature, the case counted that as
  the program limit holding, and it proved nothing. A refusal is only evidence when it is the
  refusal the case is about, so (c) now funds the right address and reports "not run" rather than
  "pass" if the answer comes back on a signature or a balance
- Finding 4: on the fork the 6 scriptable cases fell through both of the runner's not-run tests
  and were reported with an empty reason, which is the blank field the catalogue forbids. It read
  as though each had been checked and produced no answer, when nothing had been checked at all.
  Both historical blockers, funding and a missing Jupiter, are gone, so the remaining reason is the
  case bodies. (c), (d) and (f) ask only whether Swig authorises an instruction and need no swap.
  (a), (b) and (e) each need a real Jupiter swap that moves the capped mint, because a
  `tokenRecurringLimit` is applied by comparing balances after the inner instructions run: a
  synthetic instruction to Jupiter's id is rejected inside Jupiter before the limit is consulted,
  and recording that as the cap holding measures the wrong thing
- Finding 3: the platform works now and the cases are what is missing. On the fork the payer funds
  itself, both programs are present and executable, the agent role builds and passes
  `assertAgentRoleShape`, and the first transaction lands with a signature where the same
  transaction on devnet was answered "0 lamports". All 7 still report "not run" with an empty
  reason, because the case bodies were deliberately left unwritten while the platform was
  undecided. F5 is no longer blocked on a chain, a program or a faucet. It is blocked on code
  nobody has written, which is the first time that has been true
- Status: claimed 2026-09-25 | Owner: Jishnu | Branch: feature/t-f05a-cases-cdf
- Depends-on: T-D01
- Touches: spikes/F5/, scripts/board.mjs
- Serves: Novelty (judged) ; CP1 gate
- Acceptance: all 7 cases behave exactly as stated with 0 unexpected successes, (a) swap within
  cap succeeds, (b) swap over cap rejected, (c) transfer to an arbitrary address rejected, (d) call
  to a non-Jupiter program rejected, (e) allowance restored at the expected slot after the window,
  (f) root removes the role and the next agent transaction fails, (g) removal done from Phantom
  and not only our CLI
- Evidence: `spikes/F5/result.json`, the run at slot 503552939. 0 of 7 cases exercised, so nothing
  in it says the cap holds and nothing says it does not. Blocked on OP-19 for lamports and OP-20
  for a CP1 decision
- Finding: **the pinned Jupiter id is not a program on devnet.** It is a 0-byte system-owned wallet
  holding 4.51 SOL, `executable: false`, against `executable: true` and 36 bytes under the BPF
  upgradeable loader on mainnet. An agent role scoped to `programLimit({ programId: JUPITER })`
  therefore scopes to something that cannot execute there, so the 7 cases are not reachable on
  devnet at any funding level, and **live arming on devnet cannot show the cap stopping a swap,
  because on devnet there is no swap to stop.** (c), (d) and (f) do not care, Swig rejects those
  before any inner instruction runs. (b) and (e) do: a `tokenRecurringLimit` is applied by comparing
  token balances after the inner instructions run, so with no program at that id the transaction
  fails before the limit is consulted, and a pass would mean the cap read as holding when it was
  never asked. The alternative, named not taken: a Surfpool mainnet fork has the real Jupiter
  program and the real Swig program, costs 0 and needs 0 mainnet funds, and F9 already proved a
  committed Surfpool snapshot replays offline with no key. CP1 decides, see OP-20. The second
  blocker is only money, and 1,295 times smaller than the ask: the spike needs **1,543,680 lamports,
  0.0015 SOL**, not the 2 SOL OP-19 asks for, being 1,503,680 of rent for the 168-byte two-role Swig
  account plus 5,000 a transaction for 8 transactions. That size is read off devnet, not off the
  struct: of 59,948 Swig accounts there, 49,693 sit at 104 bytes and 8,661 at 168, confirmed by
  fetching 1 from each tier. 7 faucets refuse, and 0.1 SOL is refused as flatly as 1 SOL. What the
  run does prove: the 351-byte `createSwig` transaction for the real agent role reaches devnet and
  is refused for exactly 1 reason, 0 lamports, so nothing in our code is the blocker
- Kill criterion: no fallback for (b), (c), (d). If the cap does not hold on-chain, CP1 decides whether Agon ships read-only
- Finding 2: the fork has the programs, the snapshot exporter does not. `surfnet_exportSnapshot`
  leaves the export at 294 accounts and 278 KB after Jupiter and Swig are touched, with neither id
  in it; its only 2 scopes are `network` and `preTransaction` and `network` emits data accounts
  only. F9's no-key offline replay therefore does not reach F5 on its own, and every case would
  have failed for a missing program, which is how F5 already failed once on devnet and would have
  been hard to tell from progress. `record-programs.mjs` and `programs.json` carry the 4 accounts
  it drops, 4 because a BPF upgradeable program is a pointer plus a separate program-data account.
  Verified with HELIUS_API_KEY unset: both programs load at their real mainnet ids, executable,
  owner BPFLoaderUpgradeable. 4.2 MB, committed for the same reason F9's 281 KB is

### T-F05b, F5 route size, 20 Jupiter routes against the v1 limit
- Status: done
- Evidence: spikes/F5/route-size/result.json. 20 of 20 routes fit v1 inline with 0 lookup tables,
  against a bar of 18 of 20. Accounts 18 to 34 against a ceiling of 64, bytes 811 to 1416 against
  4096, 0 routes over either. 5 mints from USDC to WIF at 0.1, 1, 10 and 100 SOL, 1 to 5 venues
- Finding: the first run reported 0 of 20 and it was true and useless. Asked Jupiter's default way
  every route came back with lookup tables, so nothing fit the inline bar. But every one of those
  routes was already under the 64-account ceiling, which meant the tables were Jupiter's choice
  rather than route complexity, and the spike had measured a default instead of a limit. Asking
  with `asLegacyTransaction` returns the same route with every account inline and all 20 fit. The
  number that answers this row is the second one, and the difference between them is the finding:
  the constraint is a request parameter, not the market. Both are recorded per route so nobody has
  to take that on trust
- Second finding, from the same run: unpaced, 15 of the first 20 calls came back 429. Jupiter is 10
  requests per 10 seconds on the tier OP-3 measured and this spike makes 2 calls per route, so it
  rate-limits after the 5th. Paced at the 1100 ms `packages/core/src/net/record.ts` already uses,
  0 of 40 calls failed. Reused rather than re-derived so there is 1 number to change if the tier does
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/127 | Owner: Jishnu | Branch: feature/t-f05b-route-size
- Depends-on: T-D01, OP-3
- Touches: spikes/F5/route-size/
- Serves: Functionality (judged) ; CP1 gate
- Acceptance: 20 real Jupiter routes of increasing complexity wrapped in a Swig execute
  instruction; 18 or more of 20 fit the v1 limit (4,096 bytes, at most 64 accounts, all inline, no
  address lookup tables); the legacy 1,232-byte count is recorded for reference and is not a pass
  criterion
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/127
- Kill criterion: fallback is lowering Jupiter `maxAccounts` until the route fits 64 inline accounts and measuring the price cost; a route still needing more than 64 accounts goes out as v0 with lookup tables inside 1,232 bytes

### T-F06a, F6 spike, Trigger order owned by a Swig wallet, in simulation
- Finding 4: the deposit does not touch the agent's allowance, measured rather than assumed. The
  role's remaining allowance read 500000000 before the order and 500000000 after, against a deposit
  of 100000000, so clause 4 fails. The cause is structural: the agent cannot create an order
  because the Trigger program is not the one its role permits, root can, and a root-signed deposit
  never passes the cap. The clause describes a behaviour this architecture does not produce, which
  is OP-29 and the same shape as OP-28 on F5. **A Trigger order created by root moves funds the
  agent cap does not see**, and that is safe today only because the agent cannot create one
- Finding 5: clause 3 cannot be tested through the API on a fork. Jupiter builds cancel
  transactions from its own mainnet index, so an order created on a fork is unknown to it and the
  endpoint answers "Unable to cancel specified order", checked against the order this run created.
  Cancelling one means building the instruction against the Trigger program directly, which needs
  its layout and is the remaining work on that clause
- Finding 6, cheap and worth knowing: the spend limits live on `role.actions`, not on the role.
  `packages/chain`'s interface describes the actions object and reads as though it describes the
  role, which cost a run with `agentRole.tokenSpendLimit is not a function`
- Evidence: spikes/F6/result.json, 2 of 4 clauses. **A Trigger order was created on chain, owned
  by a Swig wallet**, on a mainnet fork, signature
  2F6ZxUNSrBifM5xuceszY4H3oi4YPvfyFveESVMynLy1CXmkfHwYeaM9qBvx7jJrbT2Z4oDLVzXkVPXiP2nkfNEb. Signed
  by root rather than by the agent role, which is the finding above and is also what T-E06
  describes. That is the 24/7 mechanism working: a rule can sit on chain owned by the user's own
  wallet with no Agon server involved
- Not asserted, and reported as not run rather than rounded to a pass: the wallet balance moved
  -109597840 lamports against a making amount of 100000000. The 9597840 difference is rent and fees
  for the order account and its token accounts, so the deposit is not the making amount at the
  wallet level and the acceptance asks for the **allowance** to move by exactly the deposit. That
  needs a role-level allowance read this run does not do. The cancel path is not written either
- Finding: **a Trigger order runs on a different program from the one the agent role permits.** The
  Trigger API does build an order with a Swig wallet, a program-derived address, as maker and
  payer, answered 200 with an order address. Decoding that transaction, the order is created by
  `j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X`, and `agentRoleActions` permits
  `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` and nothing else. Both are live and executable on
  mainnet, checked. So an agent holding the role cannot create, cancel or amend a Trigger order.
  This is not a failure of the design as T-E06 describes it, where the user's own wallet signs the
  role and the order together at arm time and root can do both. It is a constraint on anything that
  expects the agent to manage its own orders later, which is T-C08's daemon, and on the word
  revocable if revoking an order is ever meant to be something the agent does
- Finding 2, from the same run and not about F6: `scripts/feasibility.mjs` scanned `spikes/F*` only,
  so a sub-spike 1 level down was invisible. T-F05b owns `spikes/F5/route-size/`, which is where the
  board's own Touches line puts it. That spike ran, passed 20 of 20, wrote its result, and did not
  appear in FEASIBILITY.md at all. A spike nobody can see in the table is a spike that did not
  happen as far as a checkpoint is concerned, so the generator reads 1 level down now and takes the
  row id from `thresholds.json` rather than the directory name. 5 spikes became 7
- Finding 3: both of this session's thresholds files were written in a shape the generator does not
  read. It wants `test`, `name`, `threshold`, `checkpoint` and `existential`, and ignores anything
  else, so the table printed NOT WRITTEN DOWN beside a threshold that had in fact been written
  before the run. Reused the existing shape rather than inventing a second one
- Status: claimed 2026-09-25 | Owner: Jishnu | Branch: feature/t-f06a-allowance
- Depends-on: T-D01, OP-3
- Touches: spikes/F6/, scripts/feasibility.mjs
- Serves: Novelty (judged) ; CP1 gate
- Acceptance: in mainnet simulation, a Trigger V2 order is created with the Swig wallet (a
  program-derived address) as owner, a cancel returns funds, and the vault deposit reduces the
  Swig allowance by exactly the deposit
- Evidence: <spikes/F6/result.json at a commit>
- Kill criterion: fallback is our local daemon polling price and executing through Swig, and the UI must then say "runs while your computer is on". The pitch loses 24/7 execution
### T-B03, Benchmark harness on a pinned mainnet fork
- Status: open
- Depends-on: T-B01, T-E01
- Touches: benchmark/runner/, benchmark/arms/
- Serves: Functionality (judged) ; F9
- Acceptance: 1 command runs the whole benchmark from a clean checkout against a Surfpool
  mainnet fork pinned to 1 slot, so every run sees identical prices and accounts; arms and
  metrics read from the committed scenario files; CI fails if anything under `benchmark/` or the
  demo path reads a fixture marked `synthetic: true`
- Evidence: <PR link, plus 2 runs with identical verdicts>
- Kill criterion: fallback is publishing only the deterministic half (guardrail verdicts on fixed trades) and dropping the live-agent comparison

### T-B10, Clear the parked operator ids out of published source
- Status: done 2026-09-29 | Owner: Jishnu | PR: #191
- Depends-on: T-B02
- Touches: packages/core/src/net/index.ts, packages/core/src/net/record.ts, scripts/release.test.mjs
- Note: these 3 files sit inside T-C02's and T-B02's `Touches:`, and both rows are blocked on a
  human, so neither can move while every release is refused. This row is deliberately narrower
  than either: 5 prose references and 2 `KNOWN` lines, 0 behaviour. It ends when they are gone.
- Serves: Open source (judged) ; the release gate, red on dev today
- Acceptance: `node scripts/release.mjs --out <dir>` then `--check <dir>` reports 0 of 6 internal
  markers, against 2 reported today which stand for 5 live references across 2 files, because the
  checker reports the first hit per file; the 2 `KNOWN` entries in `scripts/release.test.mjs` go in
  the same commit, leaving 0 parked markers in the ratchet; `pnpm gates` exits 0; 0 numbers, 0
  thresholds and 0 behaviour change, so the whole diff is comments plus 1 printed line
- Evidence: `node scripts/release.mjs --out` then `--check`, before: "2 internal marker(s) survived",
  `packages/core/src/net/index.ts:137` and `packages/core/src/net/record.ts:22`, standing for 5
  references. After: "0 of 6 internal markers survived". `KNOWN` in `scripts/release.test.mjs` is
  empty, so the ratchet now refuses any marker in any file. 1 printed line changed, the recorder's
  "set AGON_GOLDEN_WALLET" hint, which now says what the wallet needs rather than naming an operator
  item. 0 numbers, thresholds or behaviour changed
- Finding: the obstacle the ratchet's comment gave for why these could not land, a fixtures change
  required alongside any `packages/core` diff, no longer exists. The workflow's rule covers only the
  4 contract files, and `net/` is not one of them
- Kill criterion: none. Every release is refused until this lands, so there is nothing to fall back
  to

---

# P2, CP1 to CP2 (2026-10-02)

CP2 evidence required: F1 and F2 complete; F4; F5 in simulation; F6 on mainnet ($20 orders);
F7; F9 on 20 scenarios; F11 accuracy, adversarial and numeric-routing cases (c, d, e).
- Finding: re-opened. benchmark/ holds only README.md and scenarios/scenarios.json: no runner, no arms, forkSlot null and all 100 scenario mints null. PR #15 landed the plan and says so in its own body, deferring the harness to a second PR that was never opened. The one clause that is met, CI refusing a synthetic fixture on the benchmark path, came from T-B01.
### T-A02, FIFO P&L ledger
- Status: done
- Depends-on: T-A01
- Touches: packages/decoder/src/pnl.ts
- Serves: Functionality (judged) ; F1
- Acceptance: realised P&L per wallet within 1% of a hand-computed FIFO ledger on all 5 F1
  wallets; decoded events per transaction match unique signature and leg counts on the golden
  wallets, so 0 double counting; every field name matches the value it holds, reviewed by a
  second person
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/64, plus the reproduction: the same
  4 swaps reported 0 closed trades before and 1 after
- Finding: lots were queued per mint, so a lot bought with a different quote than the sale sat
  at the head of the queue and every later sale of that mint hit it and stopped. 1 cross
  currency buy froze that mint's P&L permanently: buy BONK with SOL, buy BONK with USDC, sell
  twice for USDC, and the ledger reports 0 closed trades and 0 realised where the same wallet
  without the SOL lot reports 1 trade and 10 USDC. Queues are now keyed by mint and quote, so a
  sale only ever meets lots it can be priced against
- Finding: the case with no honest answer is the common one. A position bought with SOL and sold
  for USDC has no realised P&L without a price at the fill, because 150 USDC minus 100 SOL is not
  50 of anything, and buying with SOL then taking profit into USDC is ordinary behaviour rather
  than an edge case. It is an exception and the lot stays open; realised P&L is keyed by quote and
  never summed across quotes. Same for selling more than the decoded lots hold, which is what an
  airdrop or an incoming transfer looks like from here: only the matched units are realised and the
  proceeds are apportioned to them, because realising the whole sale would invent profit out of
  units that cost nothing on paper. Second, measured: apportioning a lot's cost by amount truncates
  under integer division, so the remainder is subtracted from the lot rather than recomputed from
  the original numbers. Over 333 partial sells of an awkward size that conserves 1000000001 base
  units exactly, 0 lost; recomputing would have leaked basis on every sell and the loss would have
  looked like rounding while inflating P&L. Third: BigInt throughout, because a lamport count above
  2^53 loses its low digits in a float and the 2 that separate 9007199254740993 from
  9007199254740995 are the whole answer.
- Kill criterion: none. monad T3.7 shipped "positions" that were trade flow, off by 67x
- Finding: same-slot ordering is a coin flip. fifoLedger sorts by slot then by base58 signature, which has no relation to intra-block order, and RawTransaction carries no transaction index so the real order is discarded at the decode boundary. A buy and a sell of the same mint in one slot produce 1 trade and the right P&L or 0 trades, a stranded lot and a false sold-more-than-held, purely on which signature sorts first. 18 of 50 sampled transactions on 5Q544fKr sit in a multi-transaction slot, and both F1 wallets trade pump.fun venues where buying and dumping inside one block is the normal pattern. No test catches it because the test helpers name signatures buy-* and sell-*, and buy- always sorts first. Fix is T-A06.
### T-F01b, F1 spike complete, 5 wallets
- Status: open
- Depends-on: T-A02, T-F01a, OP-1
- Touches: spikes/F1/
- Serves: Functionality (judged) ; CP2 gate
- Acceptance: 3 team wallets plus 2 public wallets with 200+ swaps across at least 4 venues
  (Jupiter, Raydium, Orca, Meteora, pump.fun); 50 of 50 sampled transactions correct on every
  wallet, not on average; amounts exact to base units; P&L within 1% per wallet; every
  transaction either decoded or listed as unsupported with a named reason
- Evidence: <spikes/F1/result.json at a commit>
- Kill criterion: fallback is Jupiter-routed swaps only with the covered share printed on the report

### T-A03, Rule miner
- Status: done
- Depends-on: T-A02
- Touches: packages/miner/src/
- Serves: Novelty (judged) ; F2
- Acceptance: pure functions, 0 network calls inside; finds a planted stop within 1 percentage
  point; says "no consistent stop rule" rather than inventing one when there is none; needs 20
  closed trades before claiming a stop rule and shows sizing and hold time below that ("12
  closed trades. A stop rule needs 20; sizing and hold time are shown"); output is byte-identical
  across 2 runs on the same input
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/50; the 3 synthetic ledger runs are
  the planted-stop, scattered-loss and 12-trade cases in packages/miner/src/miner.test.ts
- Finding: the hard part is refusing, not finding. A median always exists, so a miner that reports
  one tells somebody they have a 20% stop when they have never used a stop, and they believe it
  because it arrived with a number. 3 separate gates are needed and each fails its own test when
  removed: 20 closed trades, at least 5 losing trades, and a median absolute deviation of at most 2
  percentage points. The middle one is not in the acceptance line and is the one that matters most
  in practice: 20 closed trades with 2 losses is not a habit whatever those 2 losses agree on. MAD
  and not standard deviation, because 1 catastrophic exit widens a standard deviation enough to
  swallow the real stop. Second: hold time is derived and not observed. A closed trade carries
  slots, not wall-clock timestamps, so seconds come from Solana's 400 ms slot target and are
  reported as whole numbers, because the next digit would be invented precision. Third, caught by
  the compiler and not by the tests: Metrics.medianSize and realisedPnl are branded in the frozen
  contract, so the object has to be parsed rather than cast, which is the brand doing exactly the
  job it exists for. Fourth: the quote is a required argument, because Metrics.realisedPnl is 1
  signed number while T-A02 keeps P&L per quote, and summing SOL with USDC produces a total of
  nothing that looks like a total of something.
- Kill criterion: fallback is shipping only the metrics that passed and labelling the rest "coming soon" in the demo, never "N/A"

### T-F02, F2 spike, planted rules and report timing
- Status: open
- Depends-on: T-A03, OP-1
- Touches: spikes/F2/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: (a) on 20 trades exiting at an 8% loss plus 2 held to 20%+, the stop is found at 8%
  within 1 percentage point, exceptions counted as exactly 2 and their cost exact; (b) a
  random-exit ledger reports "no consistent stop rule"; (c) 2 runs on a real beta wallet give
  byte-identical output; a report for 2,000 transactions completes in 60 seconds or less including
  Helius pagination
- Evidence: <spikes/F2/result.json at a commit>
- Kill criterion: fallback is shipping only the metrics that passed, labelled "coming soon"

### T-A04, Incremental report store
- Status: open
- Depends-on: T-A02, OP-6
- Touches: packages/decoder/src/store.ts, apps/web/app/api/report/
- Serves: Functionality (judged) ; report latency
- Acceptance: decoded trades stored by wallet with the last slot, and a second report fetches
  only what is new; a rate-limited or dropped history saves a cursor and resumes from it, and the
  report is computed only on the stated range with the user told "Read 1,240 of about 2,000
  transactions, up to Jun 3. Helius returned 429. Resume continues from there."; history fetch
  pages at most 1 per 100 transactions, asserted by a counting network wrapper in tests
- Evidence: <PR link, plus the resume test>
- Kill criterion: none. monad rebuilt full history on every request (T3.6) and switching later was a rewrite

### T-C06, check_trade guard, arithmetic first
- Status: done
- Depends-on: T-C04, T-C05, T-A03
- Touches: packages/guard/src/check-trade.ts
- Serves: Functionality (judged) ; F4
- Acceptance: every numeric check is arithmetic (size, stop distance, price band, slippage, style
  fit as a share over the user's category mix); 0 model calls when all guards resolve
  arithmetically, and the no-model share is measured and reported; at most 3 network calls per
  call (1 account batch, 1 quote, 1 Jev call), asserted by a counting wrapper in tests; every
  verdict names the rule and the number ("4.1x your median size of 0.8 SOL") and is stamped with
  its data slot and rule version; response stays inside the 400-token budget on the golden wallets
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/77, with the counting wrapper in
  packages/guard/src/check-trade.budget.test.ts (3 calls, 0 of them the guard's) and the budget in
  packages/guard/src/check-trade.token.test.ts. Measured: 5 of 5 numeric checks arithmetic, 2 of 4
  of F4's scripted trade kinds resolved with 0 model answers, 3 network calls, 395 tokens worst
  case against 400. Golden wallets do not exist yet, so the budget is measured on worst cases
- Finding: the worst case verdict was 417 tokens against the 400 budget, 4.3% over, and fits at 395
  only after this file's own 4 messages lost 88 characters. 621 of those 1,578 characters, 39%, are
  3 mint-check messages T-C06 does not own, so the guard controls about 61% of its own budget.
  Separately, the 6 token categories the PRD freezes and the 6 T-C05 shipped share 0 names, and
  style fit is arithmetic keyed on exactly those names
- Kill criterion: none, a failure here is a bug and not a feasibility problem

### T-F04, F4 spike, 20 scripted verdicts
- Status: done 2026-09-29 | Owner: Jishnu | PR: #198
- Depends-on: T-C06
- Touches: spikes/F4/, FEASIBILITY.md, packages/guard/src/check-trade.ts,
  packages/guard/src/check-trade.test.ts
- Serves: Functionality (judged) ; CP2 gate
- Acceptance: 20 of 20 verdicts match the answers written down in advance (over usual size, past
  usual stop, new token outside the usual set, normal trade, and edge cases at exact thresholds);
  p95 latency 300 ms or less excluding the RugCheck call; each output names the rule and its
  number
- Evidence: `spikes/F4/result.json`, 20 of 20 verdicts matched, each by verdict and by the exact
  set of rules that fired, against `spikes/F4/cases.json`, committed with the thresholds before the
  runner existed. p95 0.62 ms and p50 0.28 ms over 200 runs of decode to verdict on the 100
  recorded transactions, network excluded, against 300 ms. Every arithmetic reason carries a
  numeric observed and limit
- Finding: the first run was 19 of 20, and the miss was a real money bug. Size and price band both
  rounded the number before comparing it with the limit, so a trade just past a limit rounded onto
  it and passed: 2.025x the median passed the 2x limit, anything up to 2.049x did, and a 1.004%
  impact passed the 1% band. Now compared unrounded, with a failing test first in
  `check-trade.test.ts`, and shown with as many places as it takes to read as past the limit:
  "2.03x your median size of 0.8 SOL, past your 2x limit", "Price impact 1.004%, past your 1%
  band". The stop rule was not affected, it compares the proposed stop itself
- Kill criterion: none needed, this is arithmetic

### T-F11b, F11 (c), (d) and (e), accuracy, adversarial and numeric routing
- Status: done 2026-09-29 | Owner: Jishnu | PR: #216
- Depends-on: T-F11a
- Touches: spikes/F11/, FEASIBILITY.md
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: on 100 labelled cases, 40 of them token categories, a better Brier score than both
  an LLM guard and a no-model baseline; on 30 adversarial cases (token descriptions, social
  links, webhook payloads, tool outputs carrying instructions aimed at the model) 0 cases where
  an injected instruction flips a verdict to "safe"; 20 numeric questions expected to fail, to
  confirm the routing rule
- Evidence: `spikes/F11/accuracy/`, 140 cases labelled and committed before the runner: 40 real
  tokens by category, 30 real descriptions and 30 adversarial texts for injection, 20 impersonation
  and 20 numeric. The questions exactly as the guard ships them (`result.json`): on the 100 Brier
  0.915 against 0.633 for no model, so worse than guessing; category 5 of 40; injection answered
  yes on all 60, so 0 of 30 attacks flipped to safe but 0 of 30 real descriptions passed;
  impersonation yes on all 20; numeric 9 of 20 right. The LLM-guard arm (MiMo, OP-9) was not run,
  so (c) cannot pass regardless. FAIL
- Finding: the shipped questions name their options `yes` and `no`, and Jev leans to `yes` whatever
  the text: a plain PayPal USD description scored 0.86 as an injection. Jev does read the text: "The
  sky is blue" against "The sky is red" came back right at confidence 1
- Finding 2: a candidate design with named options (`result-named.json`), written after seeing the
  first run on the same labels, so it is a candidate and not a result: Brier 0.644 against 0.633,
  still not better than no model; category 11 of 40, at baseline; injection passed 5 of 30 real
  descriptions and let 3 of 30 attacks through as safe (report it as a stablecoin, hide the freeze
  authority, answer no to security questions), which is worse on the property that matters most;
  impersonation imitation on all 20; numeric 9 of 20
- Finding 3: on real token text neither design separates real tokens from attacks, so wiring Jev
  into `check_trade` (T-C22) would either block every trade on a false injection or, tuned to pass
  real descriptions, start letting attacks through. That is OP-38's answer to "where does it help":
  on this data, nowhere in the trading path. Numbers stay on arithmetic, (e) confirmed at 11 of 20
  wrong. Category and impersonation have deterministic sources to measure next: Jupiter's `lst` and
  `verified` token tags and a pinned mint list
- Kill criterion: if (e) passes unexpectedly, numbers still stay on arithmetic. 1 lucky run is not evidence

### T-C07, MCP server, 4 tools and a stable list
- Status: done
- Depends-on: T-C06
- Touches: packages/mcp/src/, packages/guard/src/assess.ts, packages/decoder/src/enhanced.ts
- Serves: Functionality (judged) ; Open source (judged)
- Acceptance: exactly 4 tools (`get_report`, `check_trade`, `arm_rule`, `list_rules`) in 1 stable
  list so prompt caches survive; token budgets enforced in tests on the golden wallets,
  `get_report` 2,000 and `check_trade` 400; every unsure or failed verdict hands back to the user
  with the reason and the numbers and 0 silent retries; `check_trade` is callable by any agent
  (Solana Agent Kit, GMGN agents) and that is proven with 1 third-party client
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/80, plus the third-party client transcript in the PR
  body. Measured on the fixture wallet the mcp and web suites already share: get_report 815 chars,
  about 204 tokens, 9.8x headroom under the 2,000 budget; check_trade 315 chars, about 79 tokens,
  5.1x headroom under the 400 budget. Follow-up PR: `check_trade` is now T-C06's real guard over a
  real wallet read, reachable over Streamable HTTP so it can be port forwarded, and `get_report`
  carries FIXTURE_NOTE in its payload. Earlier state, kept because it is what the numbers above
  were measured on: `check_trade`'s answer was still T-E03's fixture verdict, not
  T-C06's arithmetic guard, which lands separately: this PR proves the shape and the transport are
  correct and stay in budget, not that the verdict is right yet
- Finding: T-E03's dispatch had no transport, so nothing actually spoke MCP; the 4-tool contract
  test only proved the internal function existed. Meeting "callable by any agent" needed a real
  `@modelcontextprotocol/sdk` `McpServer` registering all 4 tools straight from `toolContracts`,
  then a plain SDK `Client`, the same package a third-party agent framework imports, listing them
  and calling `check_trade` and `get_report` over an in-memory transport with 0 imports from this
  repo beyond `@agon/core` to check the answer. `arm_rule` refuses with `isError: true` carrying
  the exact `NotArmable` message, not a bare protocol error, so a third-party agent still gets the
  reason and the numbers. Second: the release gate's `OP-\d+` marker scan reads test file comments
  too, not only prose docs; writing "OP-1" in a code comment explaining why a fixture wallet is
  used failed `scripts/release.test.mjs` inside `pnpm gates`, before any release tag, which is
  what that gate is for. Third: `/code-review` at medium on the first commit caught a real drift
  risk before it shipped, 4 hand-written `registerTool` calls in `TOOLS` order are a second copy
  of the order this whole feature exists to keep stable, silently divergeable from `TOOLS` itself.
  It now registers by iterating `TOOLS`, so there is exactly 1 ordered list, not 2 that happen to
  agree today.
- Kill criterion: none. monad T6.8: a 2.1M-token tool result broke every question

### T-C08, Local daemon
- Status: claimed 2026-09-29 | Owner: Jishnu | Branch: feature/t-c08-daemon-signer
- Depends-on: T-D01, T-C06
- Touches: packages/cli/src/daemon/, packages/cli/package.json, pnpm-lock.yaml
- Serves: Novelty (judged) ; custody story
- Acceptance: the agent key is generated on the user's machine and stored in the OS keychain,
  and appears in 0 of `.env`, logs, our servers and the repo, asserted by the secret scan plus a
  log-grep test; the daemon signs only a transaction whose message hash matches a
  `check_trade` approval from the last 30 seconds, so a different amount or route needs a new
  check; a quote that moved more than the 1% band is re-quoted exactly once then stopped; a
  signature-status check runs before any resubmit and resubmits only when the transaction is
  confirmed dropped, so 0 double sends; offline time is reported with what did not run ("Offline
  3h 12m. Jupiter orders were unaffected. 2 event rules did not run: [list]") and 0 missed triggers
  fire late at today's prices
- Evidence: slice 1 of 3 on 2026-09-29, the parts that make signing safe.
  - Key: `agentKey()` makes the keypair on first use in the OS keychain and reads it back after,
    tested against Windows Credential Manager under a test-only service name. A log test watches
    console output while the key is made and read and finds none of its base64, hex or byte forms;
    its control, a planted `console.log` of the key, failed it, after a first version of the test
    that watched only the read path let the plant through. On CI's Linux runner there is no Secret
    Service, so these 2 skip and say why
  - Approval gate: `signApproved` signs only a message whose sha256 matches a `pass` at most 30000
    ms old. 5 tests: signed at exactly 30000 ms, refused at 30001, refused for 1 lamport more,
    refused on `block` and `unsure`, and refused for a durable-nonce transaction
  - No double send, on a local fork: a transaction the network swallowed was resent as the same
    bytes, then reported dropped once its blockhash expired, about 63 s, with the receiver at 0.
    One whose status answer was hidden for a round was resent and landed exactly once, the receiver
    holding 1234567 lamports, the amount sent
- Owed, slices 2 and 3: re-quote once when the quote moves past the 1% band, which needs the quote
  path T-C21 builds; and the offline report, which needs event rules T-C10 has not built. So the
  row stays claimed
- Finding: resending the same signed bytes is what makes a retry safe, because a signature lands at
  most once, and rebuilding is what makes it unsafe. So "confirmed dropped" is defined as blockhash
  expired with no status, and after that the daemon stops rather than rebuilds: a new transaction
  is a new trade and goes back through check_trade
- Finding 2, from `/security-review`: a durable-nonce transaction stays valid after its blockhash,
  which would make "dropped, nothing moved" false. The signer now refuses any transaction whose
  first instruction advances a nonce, with a test
- Kill criterion: none. Anything that can move funds fails closed

### T-D02, Rule expiry without admin rights
- Status: cut
- Depends-on: T-D01
- Touches: packages/chain/src/expiry.ts
- Serves: UX (judged) ; F7
- Acceptance: the agent key holds 0 `manageAuthority` at every point; at arm time the user
  signs a role-removal transaction against a durable nonce and the daemon submits it at expiry
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/72, 12 tests. The on-chain role read
  after expiry needs a funded devnet key, see OP-19.
- Finding: the durable nonce is what makes expiry possible without admin rights, and it is also
  what makes the guarantee weaker than it sounds. A blockhash dies in about 2 minutes, so a
  transaction signed at arm time is refused long before the rule is due and the rule would simply
  never end; a nonce replaces it with an on-chain value that only moves when the transaction lands,
  so the signature keeps. But that makes the signed bytes a bearer instrument: Solana has no "not
  before slot N" field, so anyone holding them can submit early. Refusing to submit early is our
  policy, not an enforcement, and the honest version of the claim is that the failure is in the
  safe direction, because a stolen authorisation can only stop the agent trading and cannot extend
  the rule, raise the cap or move funds. Second: expiry is best effort in the other direction too.
  If the daemon is not running when the rule is due, nothing submits and the rule does not end, so
  the user is told at arm time that they can always end it from their own wallet. Third: a user who
  revokes by hand first leaves the authorisation unspendable, and reading that off a submit error
  would report a working expiry as broken, so spentness is read from the nonce rather than from a
  failure. Each of the 4 guards fails its own test when removed.
- Kill criterion: fallback is no automatic expiry, a short recurring window instead, and the UI says "no end date: revoke from your wallet". Never fall back to giving the agent admin rights

- Cut 2026-09-29 by OP-30: Swig's native expiry measured holding on chain, so the pre-signed
  removal is not built. `packages/chain/src/expiry.ts` from #72 stays until something replaces it
### T-F07, F7 spike, pre-signed expiry
- Finding 2: **the native expiry holds on chain.** Measured on a fork, which funds itself so this
  no longer waits on OP-19. A session was started with a 20 slot duration, the role read back
  `expirySlot 486`, the session key was tried again at slot 489, and the Swig program refused it
  with `custom program error: 0xbc6`. Clause 4 passes in the same run and is read off the role
  rather than inferred from nothing going wrong: the agent held `manageAuthority` false.
  So clauses 2 and 3, which describe a pre-signed removal, describe a second way to do something
  the protocol already does. Whether that is still wanted is OP-30, and it decides whether T-D02
  needs building at all. Not run, with that as the stated reason rather than a blocker
- Finding 3, cheap: `createSession` is signed by the role's own authority, not by the payer. Signing
  with the payer alone fails signature verification, which cost a run
- Status: cut
- Depends-on: T-D02
- Touches: spikes/F7/
- Serves: UX (judged) ; CP2 gate
- Acceptance: first check Swig's protocol-level SDK for a native expiry field and record the
  answer; then the pre-signed removal lands after expiry and the next agent transaction fails; an
  earlier manual revoke still works and leaves the pre-signed transaction harmless; the agent key
  held `manageAuthority` in 0 of the runs
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/83, spikes/F7/result.json, 7 of 7 SDK
  checks. Clauses 2 to 4 need a funded devnet key, see OP-19.
- Finding: Swig already has a native expiry, and T-D02 may not be needed. `@swig-wallet/lib`
  defines a session based authority carrying `expirySlot` and `maxDuration`, created for a separate
  key with `createSession({ roleId, newSessionKey, sessionDuration })`. So the shape Agon wants
  exists in the program: give the agent a session key rather than an authority of its own, and when
  the session expires it simply cannot sign. No pre-signed transaction, no durable nonce, no daemon
  that has to be running at the right moment, and no bearer instrument to steal. The reason nobody
  saw it is that the wrapper hides it: `@swig-wallet/classic`, which packages/chain imports and
  which T-D01 and T-D02 were written against, exposes no expiry concept at all and its Actions
  builder has 26 permission methods with no expiry among them. Checking only the wrapper is exactly
  how a team concludes there is no native expiry and builds one, which is what happened, and it is
  why this acceptance line says to check the protocol-level SDK first. The decisive follow-up is
  whether a session key can renew itself, because a self renewing session is not an expiry: the SDK
  says it cannot, since `getCreateSessionV1BaseAccountMetasWithAuthority` puts the authority in the
  signer slot and the new session key is a parameter rather than a signer, but that is inference
  from a type declaration and not proof from the program, and proving it needs devnet. 7 of 7 SDK
  checks as expected against 2.1.0, versions recorded so a future release cannot quietly change the
  answer.
- Kill criterion: fallback is a short recurring window and no end date in the UI
- Cut 2026-09-29 by OP-30: clause 1 is answered, Swig has a native expiry and it holds on a fork,
  so clauses 2 to 4, which test the pre-signed removal, are not needed
### T-D03, Kill switch
- Status: blocked, see OP-19
- Depends-on: T-D01
- Touches: packages/chain/src/kill-switch.ts, packages/cli/src/commands/revoke.ts
- Serves: UX (judged) ; Novelty (judged)
- Acceptance: 1 wallet signature removes every Agon role; 1 command removes every Agon role
  from every test wallet, run once on devnet across at least 3 wallets with 0 roles left; revoking
  while funds sit in a Trigger order says "Rule revoked. 2.0 SOL is still inside an open Jupiter
  order. Cancel it?" and offers the cancel in the same screen, and never implies the revoke
  returned those funds
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/66, 29 tests. The devnet run over 3
  wallets needs a funded key, see OP-19.
- Finding: a kill switch can only be wrong in one direction, and the direction matters more than
  the feature. Removing 1 role too few leaves a capped agent running for another minute. Removing 1
  too many can take the user's own root authority off their own Swig, and nobody can undo that. So
  a role is only ever removed when it matches the agent shape exactly, read off the chain, and the
  shape check is the same function that arms a role rather than a second copy of the rule: the two
  can then never drift into a state where we grant a shape we will not later revoke. Tested over a
  mixed account holding a root role, a foreign role and 2 agent roles, and the plan touches 2 of
  the 4. Second: the root guard turns out to be belt and braces, because assertAgentRoleShape
  already rejects root as its first check, so removing the explicit guard fails only the test about
  the wording. Third: "1 wallet signature" is a claim about transaction size, not intent. Above 12
  removals the removals stop fitting in 1 transaction, and the command refuses and says so rather
  than quietly splitting a revoke across 2 signatures. Fourth, on wording: revoking a Swig role
  does not touch funds already inside a Jupiter order, so the open-order sentence is asserted
  against a list of words it must never contain, "returned", "refunded", "safe", "recovered".
- Kill criterion: none, this is the last layer

### T-F05c, F5 spike in mainnet simulation
- Status: open
- Depends-on: T-F05a
- Touches: spikes/F5/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: the same 7 cases pass against real mainnet accounts through `simulateTransaction`
  and a Surfpool mainnet fork, 0 unexpected successes; Swig rejects an over-cap swap and the
  user sees "This needs 3.2 SOL; 1.1 SOL left in this window, resets in about 4h 10m." with 0
  automatic retries at a smaller amount
- Evidence: <spikes/F5/result.json at a commit>
- Kill criterion: no fallback for the rejection cases. CP2 decides whether Agon ships read-only

### T-F06b, F6 spike on mainnet with $20 orders
- Status: open
- Depends-on: T-F06a, T-D04, OP-5
- Touches: spikes/F6/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: with $20 per order, a stop order that should fill is filled by the keeper when the
  price condition is met, a take-profit that should not fill does not, proceeds return to the Swig
  wallet, a cancel returns funds, and the deposit reduces the Swig allowance by exactly the
  deposit; an unfilled order shows Jupiter's order status and the trigger price against the current
  price, and never says "executed" before it is
- Evidence: <spikes/F6/result.json at a commit, plus the mainnet signatures>
- Kill criterion: fallback is the local daemon polling price, and the UI says "runs while your computer is on"

### T-F09, F9 spike, benchmark reproducibility
- Status: done
- Depends-on: T-B03
- Touches: spikes/F9/
- Serves: Functionality (judged) ; CP2 gate
- Acceptance: run the benchmark twice from a clean checkout on a mainnet fork pinned to 1 slot;
  guardrail verdicts identical across runs; agent-side variance reported across at least 5 runs per
  scenario; 1 command reproduces everything
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/43, spikes/F9/result.json, snapshot pinned at slot 450049160
- Finding: the pinned state cannot be round-tripped through JavaScript, and the corruption looks
  fine. `surfnet_exportSnapshot` returns rentEpoch as u64::MAX, 18446744073709551615, which is
  above Number.MAX_SAFE_INTEGER, so JSON.parse holds it as a float and JSON.stringify writes back
  18446744073709552000, a different integer wrong by 385 that still reads as an ordinary u64. It
  occurs 31 times in a 295 account snapshot. The first version of this spike did exactly that and
  the file looked correct; surfpool refused it only because a second attempt serialised in
  scientific notation, so a more forgiving importer would have pinned state that quietly disagreed
  with the chain it came from and every later run would have been reproducibly wrong. The recorder
  now moves the bytes as text and never parses them. Second: the CLI help says --snapshot takes the
  surfnet_exportSnapshot output, and it does not; the RPC returns {context, value} and the importer
  wants the bare map, so the export verbatim fails on `missing field lamports`. Third, measured:
  30/30 verdicts identical across 2 clean runs with no Helius key, which is what makes the number
  rerunnable by a sceptic. Reported FAIL, not pass: agent-side variance is 0 of the required 5 runs
  per scenario because OP-9 has not pinned a model, and taking the documented fallback is a CP2
  decision rather than one the spike awards itself.
- Kill criterion: fallback is publishing only the deterministic half and dropping the live-agent comparison

### T-B04, Benchmark A v1, agents with and without guardrails
- Status: open
- Depends-on: T-F09, T-C07, OP-9
- Touches: benchmark/results/a-v1/
- Serves: Potential impact (judged) ; Functionality (judged)
- Acceptance: 20 scenarios, arms 1 and 2 (agent alone; agent plus `check_trade`), model and
  version pinned, each scenario run at least 5 times with mean and range reported; 4 metrics per
  arm (dangerous trades executed, rule breaks executed, normal trades wrongly blocked, SOL at
  risk); all runs published including the ones where Agon does badly, because false blocks are a
  real cost; the scenario commit hash appears in every post
- Evidence: <benchmark/results/a-v1/ at a commit, plus the published post>
- Kill criterion: no named competitor comparison unless their run is in the repo too

### T-E04, Report page
- Status: blocked, see OP-17
- Depends-on: T-A03, T-E03
- Touches: apps/web/app/report/
- Serves: UX (judged)
- Acceptance: stop discipline, sizing, hold time and the cost of exceptions rendered from the
  report JSON with 0 accounts and 0 login; coverage share stated on the page ("based on 83% of
  your swaps") and the count of unsupported transactions with their program ids; 0 blank fields,
  0 "N/A", 0 "something went wrong"; every report asks "Is this rule right about you?" with 3
  answers (yes / no / partly) and stores the answer
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/57 renders the fixture report end to
  end with 22 tests. The staging URL needs OP-17, the 5 real wallet reports need OP-1, and storing
  the answer needs OP-6, which lists T-E04 under Unblocks while this row does not name it.
- Finding: "0 blank fields" is a property of the empty wallet, not of the happy path. A wallet with
  no history produces 0 closed trades, 3 unfound rules, 0 coverage and 0 exceptions, and every one
  of those is a slot that renders as nothing unless something is written for it, so the test walks
  every line of both a full report and an empty one against a banned list of blank, N/A, undefined,
  null, NaN and "something went wrong". An unfound rule renders its own reason, which is why
  MinedRule carries one. Second, a contract gap: Report has no quote mint. medianSize and
  realisedPnl are base units with nothing saying what of, so the page assumes SOL at 9 decimals,
  which the frozen contract's own example ("your median size of 0.8 SOL") also assumes. That works
  until the first USDC-denominated wallet and then it is silently wrong by 1000x. Third: the answer
  to "Is this rule right about you?" is refused with 503 rather than accepted when there is nowhere
  to store it, because the CP3 gate is a percentage of these answers and one accepted and dropped
  makes the gate unmeasurable without anyone finding out until the checkpoint. The storage
  destination is opted into rather than defaulted, because a default that works on a laptop and
  evaporates on a serverless host is the same silent loss with extra steps.
- Kill criterion: below a 70% "rule is right" rate at CP3, the page ships as descriptive statistics and the rule-mining claim comes out of the pitch

### T-E05, Shareable "what your exceptions cost" card
- Status: blocked, see OP-8
- Depends-on: T-E04
- Touches: apps/web/app/api/card/
- Serves: Potential impact (judged) ; share rate
- Acceptance: 1 image endpoint rendering the exception cost, generated in 2 seconds or less; the
  card carries 0 third-party wallet addresses and 0 named-person P&L; share rate tracked from
  day 1 of the beta
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/61, 0.0012 ms per card over 10,000
  renders and 0 addresses of any kind on it. The share-rate number needs OP-8 and a live beta.
- Finding: the 2 second budget is not the constraint anyone should watch. An SVG built by string
  concatenation renders in 0.0012 ms over 10,000 renders, 1.6 million times inside the budget, and
  is 924 bytes with 0 dependencies and no font to load. The real constraint is that X, and most
  social previews, only accept raster formats, so an SVG card is shareable everywhere except the
  place it exists for. That is a dependency decision (a rasteriser is tens of megabytes against
  T-B01's 300 ms cold start budget) and it is left to the board rather than taken here. Second, the
  mutation check earned its place again: the first version of the escaping test planted a script
  tag in ruleVersion, which the card never renders, so removing the escaping entirely left all 10
  tests green. The escape is now exported and tested directly and removing it fails. Third, caught
  by looking at the rendered card and not by any test: the first tagline was 58 characters and ran
  off the right edge, and the endpoint still returned 200 with a perfectly valid SVG, because SVG
  clips rather than wrapping. There is now a character budget on it.
- Kill criterion: share rate under 10% across 10+ reports at CP3, so it stops being a pitch line

### T-B08, Jev in our own dev workflow, a one-week trial
- Status: done
- Depends-on: T-B01, OP-4
- Touches: scripts/jev-review.mjs, .github/workflows/board.yml, docs/plans/jev-trial.md
- Serves: unblocks nothing; it is a measured bet on our own speed, kept or cut at CP2
- Acceptance: 4 uses run for 1 week, each kept or cut at CP2 on its own pre-written bar, in this
  priority order. (1) Second-layer review escalation, a CI script that reads the diff itself and
  asks whether it changes money math, transaction building, a frozen contract or docs another track
  reads: it may only add a required reviewer and never remove one, path rules stay primary, and it
  is kept only if it catches 38 or more of 40 labelled past diffs with 8 or fewer false flags. (2)
  Vague task lines, an advisory board comment that never blocks, kept if half the flags lead to an
  edited row in week 1. (3) Beta feedback, X replies and issues sorted into bug / feature /
  confusion / rule-wrong, anything below the confidence threshold going to a person, kept if it
  agrees with a person on 45 or more of 50 labelled items. (4) Context triage, ranking candidate
  files or log chunks before reading them, passing short excerpts only, kept if it spends fewer
  tokens per resolved bug than the same week without it, measured with the `explain-usage` skill.
  Uses needing a large input run as scripts that read the diff themselves, never as MCP calls from
  inside a session, because Claude writing a diff into a call costs more than Jev saves. Both
  candidate MCP servers are unofficial and would hold our TypeSafe key, so pin a commit and read
  the source before installing either.
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/79, docs/plans/jev-trial.md. Use (1)
  only; uses (2) to (4) are not started, their bars stay open for whoever picks this up next
- Finding: use (1)'s own bar, 38+/40 hits with 8 or fewer false flags on labelled past diffs, is
  not measured: this environment has no JEV_API_KEY and OP-4 is still open. What was measured
  without a key, 2026-09-24: 29 of this repo's 69 merged PRs are real `feature/*` work PRs with a
  non-empty diff; the other 40 are `claim/*` and `board/*` housekeeping carrying no diff worth
  measuring. Ground truth pulled from those 29 PRs' own "Second reviewer needed?" checkboxes: 3
  money math, 4 transaction-building, 0 frozen contract, 11 cross-track docs, so the 40-diff set
  this bar needs cannot come from `git log` alone, this repo's history alone supplies 0 of the 10
  frozen-contract positives a balanced 40 would want. Second: `noul`, asked "is this urgent" on 3
  texts outside this session, scored the real emergency lowest of the 3 at 0.0043, below "repaint
  the kitchen next spring" at 0.0086, inverted rather than merely weak, a second and independent
  reason (T-C05 found the first) this script uses `choice` and reads only `confidence`. Third: this
  PR's own `/code-review` pass, run before any live measurement, caught the harness counting a hit
  whenever anything was flagged on either side rather than the same category on both, which would
  have let a money-math diff read as caught by a wrongly flagged transaction-building answer.
  Fourth: pushing the `board.yml` wiring failed, this session's GitHub token carries `repo` scope
  and not `workflow`; backed out, the 2 steps to paste in are documented, unapplied, in
  docs/plans/jev-trial.md. Fifth: CLAUDE.md's "Jev answers only 3 non-numeric questions" line is
  unqualified and this script asks 4 different ones about a diff, never a trade; written up as
  OP-20 rather than decided quietly
- Kill criterion: never used for anything numeric, for deciding a task is done, for approving a merge or deploy, or for anything touching keys or funds. A Jev answer is an input to a rule, never the rule itself. Any use that misses its bar is cut at CP2, not extended

### T-B09, Stop the CI gates over-firing
- Status: done
- Depends-on: T-B01
- Touches: .gitleaks.toml, .github/workflows/board.yml
- Serves: Functionality (judged) ; unblocks T-A01 and T-E10, and every later PR carrying a fixture
- Acceptance: the secret scan reports 0 findings on T-A01's 24 recorded addresses, and still reports
  1 finding for each of 2 planted secrets, an 88-character Solana secret key and a uuid api key
  inside a recorded request URL; the frozen-contract gate fires on 0 of 2 PRs that only add a module
  under packages/core, and on 1 of 1 that changes one of the 3 contract files
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/37
- Kill criterion: none. A gate that cries wolf teaches everyone to tick the box without reading,
  which is worse than no gate

### T-E12, Build in public, weekly
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/13
- Depends-on: T-B01
- Touches: docs/plans/x-plan.md
- Serves: Potential impact (judged) ; Business plan (judged) ; share rate
- Acceptance: 1 post per week, mirrored as a Colosseum project update, generated from the Friday
  dashboard and the `engineering:standup` output; past winners (Seer, Daiko, Lomen) posted 3 to 4
  updates, so 3 is the floor by 2026-10-11; every benchmark post carries the repo commit hash and
  the 1-command rerun; 0 posts naming a person's wallet, habits or P&L without written consent, 0
  "copy this wallet" or anything reading as a recommendation, and 0 token, points or airdrop
  teasers; user share cards posted only by the user, or by us with written consent
- Evidence: <docs/plans/x-plan.md with the post links and their commit hashes>
- Kill criterion: none. It feeds 3 of the 6 judged criteria, and the rules do not restrict marketing or real users (rules s.8)

### T-E10, Failure-message catalogue
- Status: done
- Depends-on: T-C01
- Touches: packages/core/src/messages.ts
- Serves: UX (judged)
- Acceptance: all 11 failure rows from the PRD implemented as 1 message each, every one naming
  the cause, the number involved and what the user can do next; a test asserts 0 messages
  containing "N/A", "something went wrong" or an empty field; anything that can move funds fails
  closed, analytics fail open but always state what they are based on
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/32, 11 of 11 rows, 65 tests green
- Finding: 1 of the 11 rows in the PRD carries no number. The RugCheck row reads "didn't answer in
  time", which leaves a reader unable to tell a 200 ms blip from a 30 s outage, and that changes
  whether they wait and retry. The test that asserts every message names its number caught it, and
  the message now carries the timeout, because for a timeout the timeout is the number involved
- Kill criterion: none, this is the difference between a demo and a product

### T-C12, Token categories, the 6 names the PRD froze
- Status: done 2026-09-29 | Owner: Jishnu | PR: #185
- Depends-on: T-C05, T-C06
- Touches: packages/guard/src/jev/index.ts, packages/guard/src/jev/jev.test.ts,
  packages/guard/src/check-trade.ts, packages/guard/src/check-trade.test.ts,
  packages/guard/src/check-trade.token.test.ts, packages/guard/src/check-trade.budget.test.ts
- Note: these 6 files sit inside T-C05's and T-C06's `Touches:` and both rows are merged, so
  neither can move again. This row is narrower than either: 1 list of 6 strings and the prose
  that quotes it, 0 new behaviour. The PRD wins by the rule at the top of this file, so the
  shipped names are the ones that change.
- Serves: Functionality (judged) ; F11 (c), whose 40 labelled token-category cases are labelled
  with the PRD names and would score 0 against the shipped ones
- Acceptance: `TOKEN_CATEGORIES` is the 6 names the PRD freezes under F11 on p.15, character for
  character (memecoin, stablecoin, liquid-staking token, blue chip, real-world asset, other), with
  1 test pinning all 6 so a 7th or a reworded one fails the build; the count stays 6 so T-C05's
  "6-way choice" still holds; an unparseable Jev answer produces 0 categories rather than a 7th
  name, so `styleFinding` still refuses instead of scoring against a category the model never
  chose; the rename costs 0 tokens, so T-C06's 7-reason worst case is still 395 against its
  400-token budget and a pass is still 26
- Evidence: `TOKEN_CATEGORIES` is memecoin, stablecoin, liquid-staking token, blue chip, real-world
  asset, other, pinned by 1 test written first and failing against the old 6. An unrecognised
  answer now yields 0 categories, where it used to yield the 6th name `unknown`, and style fit still
  refuses on it. Measured before and after on the same tests: a pass 26 tokens and 26, the 7-reason
  worst case 395 and 395, so the rename costs 0 tokens on T-C06's budget
- Not re-checked here: the names against the PRD PDF itself. It was removed from the tree and this
  machine has no PDF text tool, so they are checked against this row's acceptance, which quotes it
- Finding: `unknown` was doing 2 jobs, a category the model could choose and the placeholder for an
  answer that could not be read, and the cache had to special-case it for the second. The PRD's
  `other` is only the first job, so all 6 now cache with no exception, and "no answer" is carried
  by the category's absence, which is what style fit already refused on
- Kill criterion: none. The PRD froze these names on 2026-09-23 and F11 (c) labels against them

### T-A05, Category mix in the report, so style fit has something to compare against
- Status: claimed 2026-09-29 | Owner: Jishnu | Branch: feature/t-a05-category-mix
- Depends-on: T-C12, T-A03, T-C22
- Touches: packages/core/src/report.ts, fixtures/contracts/report.json, packages/miner/src/,
  packages/guard/src/assess.ts, packages/guard/src/mint-check.ts, packages/guard/src/index.ts,
  packages/cli/src/commands/check.ts, packages/cli/src/commands/report-io.ts,
  fixtures/recorded/jupiter/
- Note: changes frozen contract 2 of 3, so the PR body carries the "Changes a frozen contract in
  `packages/core`" line, the diff carries the fixture, and a second person reviews. It exists
  because `TradeFacts.categoryMix` has no producer anywhere: `packages/cli/src/commands/check.ts`
  passes null, and null is the only value production has ever had.
- Serves: Functionality (judged) ; F4, whose scripted verdicts include "new token outside the
  usual set"
- Acceptance: `Report` carries a mix over the 6 T-C12 names, shares summing to 1 within 0.001 or
  the field is absent rather than partial; the miner stays pure with 0 network calls by taking a
  mint to category map as a required argument, the way it already takes the quote, so 0 Jev calls
  move inside it; at least 1 production path fills `TradeFacts.categoryMix`, taking the
  `category-mix-missing` unsure from the 100% of calls it fires on today to 0 on that path
- Evidence: slice 1 of 2 on 2026-09-29 (the style-fit half; the `Report` field is slice 2, a
  frozen contract that needs a second reviewer): `categoryMix` in the miner, pure, 4 tests written
  first, null rather than partial when a traded mint has no category; `assessTrade` takes the
  category map as data; `agon check` fills it with 1 batched listing of the wallet's traded mints,
  stamped with the mint check's slot. On the recorded wallet the CLI's style fit went from
  `category-mix-missing` on every call to an answer: mix other 1.0 over 20 closed trades, and a USDC
  buy blocked as "0 of your 20 closed trades are in the stablecoin category". The MCP path is
  `packages/mcp/src/index.ts`, inside T-C21's claim, so it is left for that row to pass the map
- Finding: all 4 tokens this wallet traded are tagged `unknown` by Jupiter (unverified, low
  organic score, launchpad tokens) and so fall to `other`. A trader of such tokens then buying a
  tagged memecoin like BONK would be blocked as a new category, which is a false block. Whether
  `unknown` means "cannot place" (mix absent, style fit unsure) or "memecoin" is a product call
- Finding 2: a USDC buy is blocked by style fit for this wallet, but buying USDC with SOL is usually
  leaving risk rather than taking a new kind on. Whether stablecoins are exempt from style fit is
  the same kind of call
- Kill criterion: fallback is shipping style fit as the `category-mix-missing` unsure with the
  reason printed, never a silent pass

- Finding 2026-09-29, before any code: the acceptance's premise does not hold. `category-mix-missing`
  fires on 0% of production calls, not 100%, because neither production path asks Jev:
  `packages/guard/src/assess.ts`, which serves the MCP `check_trade`, and the CLI's `check` both
  pass `jev: null`, and style fit only runs when a Jev verdict is present. So a mix filled here
  would change 0 answers anyone sees. It waits on T-C22, which puts Jev in that path
### T-C13, The 8-reason verdict is 452 tokens against a budget of 400
- Note: the fixture marker adds about 20 tokens to any replayed verdict, so the 8-reason case this
  row is about is now roughly 472 rather than 452. The 5-reason verdict the deployment serves
  measures 319 with the note attached. Counted here so this row's target is the real number
- Status: done 2026-09-29 | Owner: Jishnu | PR: #188
- Depends-on: T-C06, T-C12
- Touches: packages/guard/src/check-trade.ts, packages/guard/src/check-trade.token.test.ts,
  packages/cli/src/commands/check.test.ts
- Note: overlaps T-C06's `Touches:`, which is merged. T-C06 measured 395 on 7 reasons and wrote
  "if this ever goes over, the messages get shorter and the count of them stays". It went over.
  Style fit is the 8th reason and every budget fixture in that PR traded a category the wallet
  already held, so the 8th could not fire and nobody measured it. Found by T-C12: 448 tokens under
  the 6 names it replaced and 452 under the PRD's, so 4 of the 52 over budget are the rename and
  48 were already there.
- Serves: Functionality (judged) ; the check_trade 400-token budget that CLAUDE.md and T-C07 both
  pin, and monad T6.8 is the reason for
- Acceptance: the 8-reason verdict is at or under 400 tokens, down from 452, with all 8 reasons
  still present and each still naming its cause, its number and what the user can do next; 0
  reasons dropped to make the budget. The arithmetic to beat: the response is 1,806 characters, of
  which 621, 34%, are the 3 mint-check messages this row does not own, so 208 characters have to
  come out of the 562 the guard writes itself, a 37% cut, and T-C06 already took 88 out of them
- Evidence: a test of all 8 at once, written first, failed at 450 tokens, 1797 characters. After:
  397 tokens, 1587 characters, with all 8 rule ids asserted present. The guard's 5 messages went
  from 554 characters to 344; the 3 mint-check messages, 621 characters, were not touched. Each
  keeps its cause, its number and 1 next step: size "9x your median size of 0.8 SOL, past your 2x
  limit. Send 1.6 SOL or less."; stop "A 42% stop, past your 10% limit; you cut at 8%. Set 10% or
  closer."; band "Price impact 8.7%, past your 1% band. Trade smaller."; slippage "Slippage allowed
  50%, past your 1% band. Quote at 100 bps or less."; style "0 of your 214 closed trades are in the
  blue chip category. Trade one you already trade." The 7-reason case went 395 to 357, a pass
  stays 26
- Finding: what came out was "Stopped.", 5 times, which repeats the verdict field beside it, and
  second next steps such as "or raise the limit". The size message kept its opening words because
  4 places quote them, the MCP server's own instructions and a contract example among them; only its
  tail changed, and the 1 test that quoted the tail now quotes the new one
- Finding 2: the margin is 3 tokens. A 9th reason, or a longer address in a mint-check message,
  goes over again, and the next cut is not in the guard: 621 of the 1587 characters are the 3
  mint-check messages, 39%, and each repeats a 44-character address
- Kill criterion: if 8 full reasons cannot fit 400 without dropping a cause, a number or a next
  step, the choice between raising the budget and capping the reason count is not the guard's to
  take alone. Write the measurement into an OP and stop, rather than quietly shipping a truncated
  verdict

### T-C16, Say which network, to people and to agents
- Status: done
- Depends-on: T-C07
- Touches: packages/core/src/network.ts, packages/core/src/network.test.ts,
  packages/core/src/index.ts, packages/mcp/src/index.ts, packages/mcp/src/mcp.test.ts,
  apps/web/app/NetworkBanner.tsx, apps/web/app/layout.tsx, .env.example
- Serves: UX (judged) ; 0 users or agents who read test funds as real, or real funds as test
- Acceptance: 1 env var, `AGON_NETWORK`, read by both the web app and the MCP server; every web
  page shows a banner naming fork, devnet or mainnet; all 4 MCP tools return `network` as the first
  key of their result and every refusal starts with "Network:", because an agent's client shows no
  banner of ours; unset or any other value reads "not set" and never mainnet, tested on 5 bad
  values; `check_trade` stays inside its 400-token budget with the label on
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/140. check_trade 337 tokens with
  `fork`, 333 unset, 329 `mainnet`, from about 321 with no label. Built with the variable unset and
  served with `fork`, the page reads `fork`
- Finding: spreading the label into a result broke `list_rules`, whose contract is a list: `[]` came
  out as `{"network": ...}` and 2 rules would have come out as `{"0": ..., "1": ...}`. The first test
  checked only the first key and passed on it. A list now goes out under `rules`. And the banner was
  prerendered at build while the MCP server reads at start, so a host setting the variable only at
  runtime would have shown 2 different networks; the banner now reads per request
- Kill criterion: none. Saying which chain a number came from is not optional once anything can
  sign

### T-B16, One compose file: the fork and the MCP server, side by side, locally
- Status: done 2026-09-29 | Owner: manjeetsharma0796 | PR: #159
- Depends-on: T-C07, T-C16
- Touches: compose.yaml, .dockerignore
- Serves: Functionality (judged) ; unblocks T-E15's setup page and a local run of T-E06
- Acceptance: `docker compose up` from a clean checkout starts exactly 2 services. `fork` runs
  `surfpool/surfpool:1.6.0`, pinned by tag, and answers `getSlot` on `127.0.0.1:8899` within 60 s;
  its upstream is `--rpc-url` from `SURFPOOL_DATASOURCE_RPC_URL` when set and `--network mainnet`
  otherwise, never both, because Surfpool refuses the pair. `mcp` is built from the repo's own
  `Dockerfile` and answers `GET /health` 200 on `127.0.0.1:8787` with `AGON_NETWORK=fork`, so every
  result names the fork, and in its default replay mode, so it needs 0 keys to start. Every host
  port is bound to 127.0.0.1 and 0 to 0.0.0.0; 0 keys in the file or either image; `docker compose
  down` leaves 0 containers running. The 2 images are the ones OP-33's hosted target runs, so the
  only local-only lines are the port bindings
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/159. From a clean checkout: 2
  services, both healthy; `getSlot` answered on the first poll (slot 451453874); `/health` 200;
  a real MCP client's `list_rules` answered `{"network":"fork, ...","rules":[]}`; host bindings
  127.0.0.1 only; 0 key variables in the MCP environment; `down` left 0 containers
- Finding: 8787 is also Cloudflare wrangler's default dev port, and a `workerd` from another
  project held it, so the first `up` failed. The host port is `${AGON_MCP_PORT:-8787}`; the
  measurements used 8788, so the default binding was not itself measured on that machine
- Note, so nobody reads more into it: compose starts the 2 side by side and connects nothing. The
  MCP server reads recordings or Helius, never the fork, until T-C17 gives it a vault to read. And
  no row on the board adds a tool that builds a trade, so an agent pointed at this compose still
  has no trading path through Agon: it improvises a script, which is what the fork session measured
  (about 11 retries on a truncated "Simulation failed." before reading the full logs)
- Kill criterion: if the MCP image cannot start inside compose without a key, it stays out of the
  file and this row says why, rather than a key going into compose

---

# P3, CP2 to CP3, World's Fair freeze (2026-10-08)

CP3 evidence required: the loop works end to end on a team wallet; 10+ beta reports; benchmark
A v1 and benchmark B v1 published; "rule is right" at 70% or above across 10+ reports.

### T-D04, Pre-mainnet checklist, before team wallets touch mainnet
- Status: open
- Depends-on: T-F05c, T-F06a, T-D03, T-C08, OP-5
- Touches: docs/plans/pre-mainnet.md
- Serves: Functionality (judged) ; prize due diligence (rules s.13)
- Acceptance: all 8 boxes ticked with an evidence link each, and 2 team members sign off,
  neither of whom wrote the code under test: F5 passed 7 of 7 on devnet and in simulation; F6
  passed in simulation; Swig and Jupiter program ids pinned and checked against official docs
  with 0 read from user input; the agent key reads as holding 0 `manageAuthority` on-chain;
  signature-status-before-resubmit tested with 1 deliberately dropped transaction; every mainnet
  test wallet funded with $50 or less and the funding wallet is not a team member's personal
  wallet; kill switch run once on devnet removing 100% of roles; 0 agent keys in `.env`, logs or
  the repo with the secret scan passing
- Evidence: <docs/plans/pre-mainnet.md with 8 links, plus 2 sign-offs>
- Kill criterion: none. Nothing moves to mainnet with an unticked box

### T-E06, Arm a rule, wallet-signed
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/170 | Owner: Jishnu | Branch: feature/t-e06-vault-screen
- Why in-review and not done, 2026-09-29: #170 merged and the flow is measured on the fork with a
  keypair in the wallet's place. The acceptance says the user's wallet, and no real Phantom has
  clicked through it yet. That is T-E07's outside tester or T-E16's person; this moves to done when
  either records it
- Depends-on: T-F05a, T-F06a, T-D01, T-D07
- Touches: apps/web/app/arm/, apps/web/src/arm-flow.ts, apps/web/src/arm-flow.test.ts,
  apps/web/package.json, packages/chain/src/arm.ts, packages/chain/src/arm.test.ts
- Scope, 2026-09-29: working functionality only, no visual polish, which is T-E16's and a person's.
  The same screen carries revoke, because revoking is part of managing the vault and T-E07 is now
  the outside test of it rather than a second page
- Serves: UX (judged) ; Novelty (judged)
- Retargeted 2026-09-28 against what the fork measured, replacing "do not start this until F5 and
  F6 pass". See T-B15 for why the gate moved rather than opened
- Acceptance: 1 flow on the fork in which
  the user's wallet creates the Swig, adds the agent role (`program = Jupiter`,
  `tokenRecurringLimit`), creates the vault's token accounts and funds them, with the vault
  signing nothing; the cap our code sends equals the number the user typed, asserted by a test,
  and the rolling worst case is printed beside it per OP-32; the screen shows the vault's balances
  itself, because Phantom reads "not supported" on Solana Localnet; any Trigger order is placed by
  the owner here, per OP-29, and never by the agent; wallet connection is the only auth and there
  are still 0 accounts; 0 mainnet transactions, which stays gated by T-D04
- Evidence: `apps/web/src/arm-flow.test.ts` on a fork, in the order the screen runs: arm in 2
  wallet approvals; the vault reads back 1000000000 lamports of wSOL; the cap as the CHAIN holds it
  equals the 500000000 typed, and the rolling worst case 1000000000 is shown beside it; a second
  arm on the same wallet is refused; revoke removes 1 agent role and leaves the 1000000000 in the
  vault; re-hire adds 1 back. Passes in 2.9 s against the fork and skips in CI, which has no chain.
  In a browser: `/arm` renders with 0 console errors, `Buffer` exists at runtime; served as
  mainnet the same page refuses and has 0 Connect buttons. 3 tests on SOL parsing. After every
  arm or re-hire the role is read back from the chain and checked against what was typed, and the
  control holds: the same role checked against a cap 1 lamport higher is refused
- Finding 3, from this PR's own security review: the first version never ran that post-landing
  check, although the builder's comment names it as the only check that can catch a cap sent
  higher than the user typed. It also reported "the agent can no longer trade" after a revoke
  that the kill switch had declined to finish, because it ignored the roles it kept. Both fixed
  here: arming fails loudly on a mismatch, and every kept role is named with its reason
- Not evidenced here, on purpose: a real Phantom clicking through this screen. That is T-E07's
  outside tester and T-E16's person, because a click-through by an agent in a browser with no
  wallet extension would be a demonstration of nothing
- Finding: typed SOL must not pass through a float. 0.3 as a double is 0.2999999999999999889, so a
  cap parsed with `Number` is not the cap the user typed, which is the one number this screen must
  never get wrong. `parseSol` is string arithmetic on 9 decimal places, and the negative case was
  caught reporting "not a number" rather than its real reason by the test written before it
- Finding 2: the `buffer` dependency was unnecessary and knip was right twice. Next.js bundles its
  own `buffer` for client code, and `'buffer'` is also Node's builtin name, so the import never
  reached the declared package. Removed rather than silenced
- What is gated and what is not, because "do not start" reads as all of it: the **arming screen**
  is gated, and that is this row. Connecting a wallet and reading an address from it is not gated
  by anything and is T-E14, which can start today. The gate is specific: if F5 fails the cap is
  not known to hold and there must be no screen offering to arm one, and if F6 falls back to
  daemon polling the same screen has to say "runs while your computer is on", which is a different
  screen rather than a different sentence
- Known gap, before anyone designs against the contract: `arm_rule`'s input is `RuleSpec`, which
  carries `mints`, `cap`, `triggerType` and `expiresAt` and **no wallet and no evidence of
  approval**. So the contract cannot express "this user approved this cap for this account", which
  is exactly what this row's acceptance promises to assert. That is OP-27, and it is a frozen
  contract, so it wants settling before the screen is built rather than after
- Kill criterion: if F6 fell back to daemon polling, the screen must say "runs while your computer is on"

### T-E14, Connect a wallet instead of pasting an address
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/141 | Owner: manjeetsharma0796 | Branch: feature/t-e14-connect-wallet
- Depends-on: T-E04
- Touches: apps/web/app/(onboarding)/, apps/web/app/wallet/, apps/web/package.json,
  pnpm-lock.yaml
- Serves: UX (judged) ; unblocks the arming flow without waiting for it
- Acceptance: **this is not gated on F5 or F6 and can start today**, because nothing here signs
  anything; connect works from Phantom and from Backpack; the address shown is read from the
  connected key and is never typed; disconnect clears it; pasting an address still works for a
  visitor with no wallet, because the read-only beta must not require one; 0 signature prompts are
  raised anywhere in this task, asserted by a test that fails if `signTransaction` or
  `signMessage` is reachable from this screen; 0 accounts are created and there is still no login
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/141, with `no-signing.test.ts` proving
  0 signature prompts across the 3 sources behind the screen. Connect, account switch, lock,
  disconnect and the /report handoff checked in the browser with a Wallet Standard test wallet.
  The 2 recordings with the real Phantom and Backpack extensions are still owed
- Finding: the page did not follow the wallet's own account changes, so switching accounts in
  Phantom left it showing a key that was no longer connected; now fixed with the standard:events
  listener. And knip scanned only `apps/*/src`, so all of `apps/web/app` was invisible to it and
  the new dependency read as unused
- Kill criterion: if no adapter works cleanly, the paste field stays and this is cut. Pasting an
  address is the read-only beta's real entry point and it already works
- Note for whoever picks this up: today `apps/web/app/(onboarding)/page.tsx` holds a text input and
  pushes to `/report?wallet=...`. That handoff is the seam. Connecting a wallet replaces where the
  address comes from and nothing downstream changes, which is why this is separable from T-E06 and
  why it does not wait on a spike. No wallet adapter is in the repo today, so adding one is a new
  dependency and the PR needs a `**Dependency:**` line saying why the stdlib will not do
- Note on scope: connection only. The moment a screen asks for a signature it is T-E06, which is
  gated, and the gate is real rather than cautious

### T-E07, Revoke from the wallet, live
- Status: open
- Depends-on: T-E06
- Touches: none, it is a test by a person
- Serves: Novelty (judged) ; UX (judged)
- Retargeted 2026-09-29: the revoke button lives on T-E06's screen, and a Phantom removal was
  already measured on the fork, so this no longer waits on T-D03. What is left is the part no agent
  can do: a person outside the team using it
- Acceptance: revocation tested from Phantom and Backpack by at least 1 person outside the
  team, with 0 Agon involvement in the transaction; the page states plainly that revoking needs 0
  help from us
- Evidence: <2 wallet recordings from an outside tester>
- Kill criterion: none. "Revoke without us" is the on-chain UX claim

### T-B05, Benchmark B v1, speed and performance of the safety layer
- Status: open
- Depends-on: T-F04, T-F11b, T-B03, OP-9
- Touches: benchmark/results/b-v1/
- Serves: Potential impact (judged) ; Functionality (judged)
- Acceptance: 3 arms on the same 100 labelled cases (arithmetic only; arithmetic plus Jev; LLM
  guard alone with a pinned model and structured output); p50 and p95 of the full `check_trade`
  call plus correct verdicts on the 100 cases, cold and warm runs reported separately; the
  no-model share reported; headline in the required form, "Safety verdict in p95 X ms vs Y ms for
  an LLM guard, with Z% fewer wrong verdicts", with 0 latency numbers published without the
  accuracy number in the same sentence; the measured overhead versus bare Jupiter MCP
  published and called parity, never an improvement
- Evidence: <benchmark/results/b-v1/ at a commit, plus the published post>
- Kill criterion: if the LLM-guard baseline is not beaten, the speed claim does not get published at all

### T-C09, agon CLI
- Status: claimed 2026-09-24 | Owner: Jishnu | Branch: feature/t-c09-conflict-lint
- Depends-on: T-C07, T-C08
- Touches: packages/cli/src/, scripts/board.mjs
- Serves: UX (judged) ; Open source (judged)
- Acceptance: installs, registers the MCP server with the user's assistants and starts the
  daemon in 1 command; cold start under 300 ms, asserted in CI; published to npm with
  provenance
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/76 and the follow-up adding
  `agon check`, which refuses a real trade with its numbers and exits 1, pasted in OP-22.
  `agon report` runs the whole path on a real wallet: 100 transactions read, 77 of 80 swaps decoded at 96%, 28 closed trades,
  3 rules mined, and it replays offline from a recorded fixture with 0 keys. The acceptance
  itself is NOT met: npm publish and MCP registration need T-C07 and T-C08
- Finding: the first end to end run threw immediately, and no isolated test could have caught
  it. Helius has 2 transaction endpoints with different shapes: `getTransaction` returns
  meta.preTokenBalances and postTokenBalances, and the enhanced endpoint, the only one that
  pages a wallet's history, returns a flat signature and already-subtracted
  accountData[].tokenBalanceChanges. Every decoder fixture was recorded in the first shape, so
  every decoder test passed against a shape the product never fetches. Translated at the edge,
  in the CLI's io layer, so the decoder stays single shaped and pure. Second finding, from the
  same PR: the first file larger than 1 MB broke 2 shared gates at once. `scripts/board.mjs`
  reads the PR diff through `execFileSync`, whose default maxBuffer is 1 MB, so hygiene died
  with `spawnSync git ENOBUFS` and printed a megabyte of the diff instead of a reason. Raised
  the buffer and said why in a comment. Separately the Helius enhanced response names token
  accounts rather than owners, and gitleaks read 885 public base58 addresses as generic API
  keys, so `tokenAccount`, `fromTokenAccount` and `toTokenAccount` join the match scoped
  allowlist. Re-verified that a planted key in that same fixture still fails the scan
- Finding 3: the slice only refuses once both halves are wired, and wiring them showed the guard
  cannot say `pass` from the CLI at all today. With no quote and no injection screen, 2 of its 5
  answers are "not read", and unscreened text is `unsure`, which is not a soft pass. That is the
  contract behaving correctly and it means `agon check` is a refusal machine until the quote and
  the screen are wired, which is worth knowing before a demo is built around a green verdict
- Finding: wiring the real guard behind MCP showed the server had no way to be reached at all.
  `createServer()` existed and every test passed, because each one wired an in-memory transport
  inside its own process, so "callable by any agent" was proven against a client that shared the
  server's heap. There was no stdio entry, no HTTP entry and no bin, so a fresh assistant on
  another machine had nothing to connect to. Added a Streamable HTTP entry on `node:http`, no
  express, since the SDK transport takes a plain req and res. Second finding from the same pass:
  `FIXTURE_NOTE` existed and was never surfaced over MCP, so an agent calling `get_report` got
  example numbers with nothing saying they were examples, which is worse than not having the tool.
  It now rides in the payload, 77 characters against a budget measured at 227 of 2,000
- Finding 3, from an outside agent testing the deployed URL: a marker on the protected tool does
  not protect the unprotected one. `get_report` carried FIXTURE_NOTE and the agent correctly
  refused to quote its numbers. `check_trade` carried nothing, so when it named USDC's real freeze
  and mint authorities the agent checked those facts against mainnet, found them true, and
  reported that the tool was reading chain state. It was replaying a recording. Every number was
  true and the conclusion was wrong, and nothing in the payload could contradict it. The cause was
  a static list: fixture-backing is a runtime fact for `check_trade`, live with a key and replayed
  without one, and a hardcoded list cannot express that. `NetResult.fromFixture` had existed since
  the record wrapper was written with 0 consumers outside tests; it has one now. Measured at 319
  tokens of the 400 budget with the note attached
- Finding 4, from a second outside agent, 23 probes: the server's own `instructions` were the
  least reliable thing in it. They claimed check_trade "reads that wallet's last 100 transactions"
  and "reads the mint's authorities off the chain", which is true with a key and false in the
  replay deployment, while the payload note said the opposite. An agent read them, believed them,
  and reported recorded data as live; the first agent made the same mistake for the same reason.
  Prose about runtime behaviour goes stale the moment the runtime differs, so the paragraph is
  derived from `mode()` now and cannot. Same pass: the replay miss reached callers verbatim, with
  the fixture path it wanted and the env var that records it, which is a developer message on a
  public endpoint; and a size of 0 was accepted, sailing under every median so the size rule never
  fired and a non-trade came back shaped like a trade that had been examined
- Kill criterion: none, the MCP server is how any agent reaches the guard

### T-E08, Onboarding
- Status: blocked, see OP-8
- Depends-on: T-C09, T-E04
- Touches: apps/web/app/(onboarding)/, docs/public/quickstart.md
- Serves: UX (judged)
- Acceptance: a new user goes from the landing page to a report in 3 steps or fewer, measured
  on 5 beta users with 0 help from us; the quickstart and the MCP tool reference are in
  `docs/public/` so they reach the public repo
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/88, 2 actions from landing to report.
  The 5 timed walkthroughs need beta users, see OP-8.
- Finding: there was no front door. `/` was a 404, because apps/web/app held api, report and
  waitlist and no root page at all, so the landing page the acceptance measures from did not exist.
  Worse, the public README already told a judge to "start with docs/public/quickstart.md", and
  docs/public did not exist either, so the repo anybody clones opened with a dead link. Both are
  now there and both reach the public tree, checked by running the release copy. Second: the MCP
  tool reference is generated from the frozen contracts rather than written beside them. T-C01's
  argument is 1 definition with 4 consumers proven by 1 shape change failing in all 4, and a
  hand-written reference would be a fifth consumer that fails nowhere, still describing the old
  shape, in the public repo, to the agent authors we want integrating. A test fails when the
  committed file is stale. Third: the path is 2 actions and not 3, because the report reads the
  address off the query string and starts itself, so arriving is not something the user does.
- Kill criterion: none, UX is a judged criterion

### T-E09, Beta cohort, 10 to 20 read-only users
- Status: open
- Depends-on: T-E04, T-E05, OP-8
- Touches: docs/plans/beta.md
- Serves: Business plan (judged) ; CP3 gate
- Acceptance: 10 to 20 active Solana traders recruited from team networks, trader Discords,
  Telegram and X replies; 10+ reports run; "rule is right" at 70% or above; share rate and 7-day
  return rate recorded; users sign 0 things because it is read-only; 0 addresses stored beyond the
  session unless the user opts in
- Evidence: <docs/plans/beta.md with the 4 numbers>
- Kill criterion: below 70%, the report ships as descriptive statistics, the rule-mining claim comes out of the pitch and the X posts, and the miner is the problem to fix before the fall build, whatever F2 said

---

# P4, submission (2026-10-11, a day before the deadline)

### T-J01, Demo video
- Status: open
- Depends-on: T-E06, T-E07, T-B04, T-B05, OP-14
- Touches: docs/plans/video.md
- Serves: UX (judged) ; Potential impact (judged)
- Acceptance: 3 minutes, following T-E01's script beat for beat, on mainnet with team wallets
  capped at $50 each and 0 third-party funds at risk; the loop shown end to end, mine, check,
  arm, revoke; 0 unverified claims on screen
- Evidence: <video link>
- Kill criterion: none. The video is how judges see everything else

### T-J02, Public repo release and public docs
- Status: open
- Depends-on: T-B02, T-C09, OP-13
- Touches: README.md, LICENSE, docs/public/, .publicinclude
- Serves: Open source (judged)
- Acceptance: the public repo holds `apps/`, `packages/` and their unit tests, `benchmark/`
  (scenarios, runner, results), `README.md`, `LICENSE`, `.env.example`, `docs/public/` and 1
  public CI workflow, and 0 of `TASKS.md`, `OPERATOR_TODO.md`, `FEASIBILITY.md`,
  `CLAUDE.md`, `.claude/`, `spikes/`, `docs/plans/` or scratch files; the stripped tree installs,
  builds and passes its tests on its own; at least 1 release per day during the hackathon
- Evidence: <public repo link, plus the release run on the stripped tree>
- Kill criterion: none. Every branch of a public repo is public, which is why main lives alone

### T-J03, World's Fair submission
- Status: open
- Depends-on: T-J01, T-J02, T-E09, OP-10
- Touches: docs/plans/submission-wf.md
- Serves: all 6 judged criteria
- Acceptance: submitted by 2026-10-11, 1 day before the 2026-10-12 23:59 PT deadline; 1 team
  leader named because prizes are paid only to them (rules s.15); 1 submission for the team
  (rules s.7); 0 production releases in the 24 hours from 2026-10-10 unless one fixes a broken
  demo
- Evidence: <submission confirmation>
- Kill criterion: none

---

# P5, fall build, CP4 (2026-10-16) to CP6 (2026-10-30), submit 2026-11-01

### T-D05, Mainnet beta gate, CP5
- Status: open
- Depends-on: T-D04, T-E07, OP-11
- Touches: docs/plans/pre-mainnet.md, docs/public/beta-terms.md
- Serves: Business plan (judged) ; Functionality (judged)
- Acceptance: everything in T-D04 plus 6 more, and beta stays read-only until all 6 hold: 2 weeks
  of team-wallet mainnet use with 0 unexplained transactions; per-user cap defaults to $25 per
  window and our code cannot set a cap higher than the user typed, asserted by a test; beta terms
  state plainly that the software is experimental, that the capped amount can be lost, and that
  revoking from the wallet works at any time; a second engineer has reviewed 100% of the lines
  that build a transaction or a Swig instruction; revocation tested from Phantom and Backpack by
  someone outside the team; an incident plan names who runs the kill switch, how users are told,
  and within what time
- Evidence: <docs/plans/pre-mainnet.md with 14 links>
- Kill criterion: any unticked box and the beta stays read-only. No mainnet arming before 2026-10-12 under any circumstances

### T-F10, F10 spike, balance- and event-triggered rules
- Status: open
- Depends-on: T-C08, OP-2
- Touches: spikes/F10/
- Serves: Functionality (judged) ; CP4 gate
- Acceptance: 200 known events over 24 hours on team wallets with a reconciliation poll every 60
  seconds as the reference; p95 from slot to our handler 5 s or less; 0 events found by the poll
  that the webhook missed; cost within plan
- Evidence: <spikes/F10/result.json at a commit>
- Kill criterion: fallback is poll-only triggers at 60 seconds, stated in the UI

### T-C11, Apply the CP1 decision: freezing is reported, seizure blocks
- Status: done
- Depends-on: T-C04, T-F03
- Touches: packages/guard/src/mint-check.ts, packages/guard/src/mint-check.test.ts, spikes/F3/
- Serves: Functionality (judged) ; CP1 decision on F3
- Acceptance: with `mint-freeze-authority` out of the blocking set, the F3 spike measures 9 of 9
  seizure mints blocked, 0 of 11 blue chips blocked with cbBTC relabelled as the regulated issuer it
  is, and 0 of 10 fee-only mints blocked; USDC and USDT return verdict `pass` carrying a reported
  freeze-authority reason rather than no reason at all; the threshold in `spikes/F3/thresholds.json`
  is rewritten with a note naming who changed it and why, per the feasibility bar
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/68
- Kill criterion: none. The alternative was blocking USDC, the most traded token on Solana, and a
  guard that blocks USDC gets switched off by its user on day 1

### T-C10, Event-triggered rules in the daemon
- Status: open
- Depends-on: T-F10
- Touches: packages/cli/src/daemon/triggers.ts
- Serves: Functionality (judged)
- Acceptance: webhook calls verified against `HELIUS_WEBHOOK_SECRET` with 0 unverified
  payloads acted on; every webhook payload passes the injection screen before any field is read;
  missed triggers are listed and 0 are fired late at today's prices
- Evidence: <PR link, plus a 24-hour run log>
- Kill criterion: fallback is 60-second polling with the UI saying so

### T-F08, F8 spike, screener index
- Status: open
- Depends-on: T-A03, OP-2
- Touches: spikes/F8/
- Serves: Potential impact (judged) ; CP4 gate
- Acceptance: seed 5,000 wallets with 50+ swaps in the last 90 days; full ingest in 24 hours or
  less within the Helius credit budget; rank correlation between the first and second half of each
  wallet's history of 0.5 or more; search p95 500 ms or less
- Evidence: <spikes/F8/result.json at a commit>
- Kill criterion: fallback is raw filters (hold time, size band, venues) with no consistency ranking, and the pitch drops the claim

### T-B06, Behavioural screener over the seeded index
- Status: open
- Depends-on: T-F08
- Touches: apps/web/app/screener/
- Serves: Potential impact (judged)
- Acceptance: search p95 500 ms or less over 5,000 wallets; 0 "copy this wallet" framing and 0
  named-person habits or P&L without consent; Agon describes behaviour and never says what to buy
- Evidence: <staging URL, plus the p95 number>
- Kill criterion: if F8 failed, ship raw filters only and drop the consistency claim

### T-F11c, F11 (f), Jev cost against the advertised price
- Status: open
- Depends-on: T-F11b
- Touches: spikes/F11/
- Serves: Business plan (judged) ; CP4 gate
- Acceptance: our own invoice checked against the advertised $0.042 per million input tokens;
  cost within 2x of the advertised price
- Evidence: <spikes/F11/result.json at a commit, plus the invoice>
- Kill criterion: fallback is the LLM guard or Kev-0.5B locally

### T-B07, Benchmark A v2 and B v2
- Status: open
- Depends-on: T-B04, T-B05, T-C08
- Touches: benchmark/results/a-v2/, benchmark/results/b-v2/
- Serves: Potential impact (judged) ; CP6 gate
- Acceptance: A v2 runs all 100 scenarios across all 3 arms, and the third arm is the point, an
  injection that tricks the agent into skipping the check still hits the on-chain cap; B v2 adds a
  4th arm (arithmetic plus LLM guard), a Kev-0.5B arm running locally, Brier calibration with a
  reliability plot, cost per 1,000 checks from our invoices, end-to-end timing from the agent
  deciding to trade to a signed transaction, and on-chain overhead in compute units and fees for
  the Swig wrapper versus a direct Jupiter swap; 1 command reproduces all of it
- Evidence: <both result directories at a commit, plus the published posts>
- Kill criterion: publish every arm, including the ones where Agon does badly

### T-E13, Every surface that serves a fixture says so, not just the two that already do
- Status: claimed 2026-09-25 | Owner: manjeetsharma0796 | Branch: feature/t-e13-fixture-note-surfaces
- Depends-on: T-C07
- Touches: apps/web/src/routes.ts, apps/web/src/card.ts, apps/web/src/fixture-note-surfaces.test.ts, packages/mcp/src/mcp.test.ts
- Serves: Functionality (judged) ; the honesty rule that a fixture is never served unlabelled
- Acceptance: `FIXTURE_NOTE` appears in 0 places in `apps/web/src/routes.ts` today and in 2 after
  this, being the report and check_trade JSON responses; the share card's footer names itself an
  example while fixtures back it; 3 tests, 1 per surface, each failing before the change; the marker
  text stays defined in exactly 1 place, `apps/web/src/fixture-note.ts`, however many surfaces attach
  it
- Evidence: <PR link, plus the 3 failing-first tests>
- Kill criterion: none. A number served without saying where it came from is the one output this
  project cannot ship, and the report page already got this right
- Finding: T-C07 fixed exactly this and the fix did not reach far enough, which is the same shape of
  miss as its own finding that "a marker on one tool protected only that tool". The marker reached
  the 4 MCP tools and the report page, which renders it in a `role="note"` panel. It did not reach
  `apps/web/src/routes.ts`, where `reportRoute` returns the synthetic report with the CALLER'S wallet
  written into the `wallet` field and no note anywhere in the payload, and `checkTradeRoute` returns
  a fixture verdict the same way. Measured: `grep -c FIXTURE_NOTE apps/web/src/routes.ts` is 0. The
  echo itself is deliberate and tested at `apps/web/src/legs.test.ts:17`, so this row does not remove
  it: pasting your address and seeing your address is the intended UX, and the label is what makes it
  honest. Ruled out on inspection: the share card is already correct about identity, carrying no
  address at all and saying so on its face, so only its "this is an example" half is missing.
  Second finding, which corrected this row's own acceptance: **the marker cannot live in one place in
  the payload.** `Report` is a plain `z.object`, and zod strips any key the contract does not declare,
  so a note added inside `report()` is silently discarded by `Report.parse`, verified by running zod
  directly. Attaching it per surface after parsing is forced by the contract, not a shortcut, and the
  clause asking for a single copy of the attachment was written before that was checked. What is
  single-sourced is the text. The existing MCP parity test compared the tool result against the HTTP
  body and asserted they are equal because it is one function, so it broke the moment one side gained
  a marker the other attaches a layer up; it now compares what is left with the marker taken off and
  asserts the marker separately, so it cannot pass by both sides losing it

### T-C14, Two surfaces that tell a reader something false, neither needing a contract change
- Status: claimed 2026-09-25 | Owner: manjeetsharma0796 | Branch: feature/t-c14-health-head-and-f1-ref
- Depends-on: T-C07
- Touches: packages/mcp/src/serve.ts, packages/mcp/src/serve.test.ts, spikes/F1/result.json,
  FEASIBILITY.md
- Serves: Functionality (judged) ; the health probe everyone watches, and the gate doc everyone reads
- Acceptance: `HEAD /health` answers 200 where it answers 404 today, with 0 bytes of body, and `GET`
  keeps its exact JSON, asserted by a test that spawns the built server and probes both methods;
  `FEASIBILITY.md`'s F1 row names OP-23 rather than OP-20, fixed in the generator's input and
  regenerated rather than hand-edited, with 0 other rows changing
- Evidence: PR link below. Spawned server: HEAD 200 with an empty body, GET 200 with its exact JSON
  unchanged, from a real node process rather than a called handler. FEASIBILITY.md: 1 line changed,
  so 0 other spike rows moved. 259 tests pass across 38 files
- Kill criterion: none, but if making HEAD answer means moving where the server starts listening,
  the fix is dropped rather than risking the one process the deploy runs
- Finding: the stale operator reference was in the file **twice**, and the code review caught the
  second one after the first was fixed. `measured` said "what OP-20 is" and `notes` said "Picking the
  2 wallets needs a person, which is OP-20". Only `measured` reaches `FEASIBILITY.md`, so fixing that
  alone would have left the generated gate doc correct while its own source misdirected anyone who
  opened it, which is worse than either being wrong: one of two identical errors fixed reads as
  deliberate. Generalises to every generated file in this repo: grep the INPUT, not the output, or
  you fix what is displayed and leave what is true. Second, smaller: `handle` in `serve.ts` is not
  exported and the file starts listening on import, so the health path had no test at all and could
  not get one without moving where the deployed process begins listening. Spawning a real node
  process, the way `packages/chain`'s import test does, buys the coverage without touching startup

### T-C15, Three things the payload cannot say without opening a frozen contract
- Status: open
- Depends-on: T-C01
- Touches: packages/core/src/check-trade.ts, packages/core/src/report.ts,
  packages/guard/src/check-trade.ts, fixtures/contracts/
- Serves: Functionality (judged) ; an agent acting on a verdict it can read correctly
- Acceptance: each reason carries the `severity` the guard already computed, so a client reads it
  from a field instead of inferring it from sort position; `Report` carries the fixture's own wallet
  beside the echoed one, so 1 field rather than a trailing note distinguishes the 2; a size of 0 is
  refused by the contract rather than answered `unsure`; the fixtures change in the same commit, and
  the frozen-contract box is ticked with a reviewer who did not write it
- Evidence: <PR link, plus the fixture diff that proves the shape change fails loudly>
- Kill criterion: none, but this is deliberately not urgent. All 3 are imprecision and none is a
  fail-open: `verdict` already carries the actionable answer, and a size of 0 answers `unsure`, which
  is documented as not a soft pass, so nothing executes on it
- Finding: all 3 were found by an outside probe of the deployed endpoint and all 3 stop at the same
  wall, which is why they are 1 row and not 3. `severity` is computed in
  `packages/guard/src/check-trade.ts` from line 105 and dropped when a `Finding` is mapped to a
  `reason`, so the information exists and is thrown away at the boundary. The wallet echo cannot be
  labelled by a field because `Report` is a plain `z.object` and zod strips any key the contract does
  not declare, which is the same wall T-E13 hit and worked around with a note attached after parsing.
  A size of 0 is admitted on purpose by the pattern `^(0|[1-9][0-9]*)$`. Each fix is small; the gate
  in front of all 3 is a named human reviewer, which is the scarce thing here and not the code

### T-E11, Pricing slide and paid-tier waitlist
- Status: open
- Depends-on: T-E09
- Touches: docs/plans/pricing.md, apps/web/app/pricing/
- Serves: Business plan (judged)
- Acceptance: 1 pricing slide with tiers and 1 waitlist; beta retention week over week reported
  alongside it; 0 token, points or airdrop mentions anywhere, because they add legal and
  due-diligence risk for 0 judging benefit
- Evidence: <slide, plus the waitlist count>
- Kill criterion: none, Business plan is a judged criterion

### T-J04, Fall hackathon submission
- Status: open
- Depends-on: T-B07, T-D05, OP-12
- Touches: docs/plans/submission-fall.md
- Serves: all 6 judged criteria
- Acceptance: submitted by 2026-11-01, 1 day before the 2026-11-02 close; 50+ beta users with
  rules armed, revokes, blocked trades and retention reported; 0 production releases in the 24
  hours from 2026-10-31 unless one fixes a broken demo
- Evidence: <submission confirmation>
- Kill criterion: none

---

# Done

Move a row here when its `Status:` reaches `done`, keeping its `Evidence:` link and the finding
it measured. This section is the honest history of the build, so nothing leaves it.

_(empty)_

### T-B11, Key material gitleaks cannot see
- Status: done
- Depends-on: T-B01
- Touches: .github/workflows/gates.yml, scripts/secret-shapes.mjs
- Serves: Functionality (judged) ; protects every PR that carries a fixture or a key
- Acceptance: a second scan, independent of `.gitleaks.toml`, reports 0 findings on the recorded
  fixtures now on dev and 1 finding for each of 3 planted shapes: a 64-number JSON byte array, a PEM
  private key block, and a keypair committed under a name the gitleaks default config exempts by
  path. The scan must NOT fire on a 32 to 44 character base58 value, which is what the fixtures are
  made of, and must NOT fire on an 87 to 88 character base58 value, measured at 1,040 hits on this
  tree of which 1,035 are signatures in recorded fixtures and 5 are the documented PINNED_SWAPS
  list in packages/core/src/net/record.ts, all 5 read by hand and all public swap signatures
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/99
- Kill criterion: none, but it is cut rather than loosened. If it needs a path exemption to pass, it
  has become the hole it exists to close, because a path exemption is how this one got in
- Finding: the gitleaks allowlist cannot be tightened to close this. The rule that lets recorded RPC
  fixtures through forgives a 32 to 44 character base58 value under a field whose name ends in Key,
  and a Solana PUBLIC address and a 32-byte ed25519 SECRET seed are byte-for-byte the same shape, so
  no regex over the value separates them. Separately, `useDefault = true` inherits 24 path
  exemptions including *.png, *.zip, *.pdf and lockfiles, so a keypair committed as assets/logo.png
  is never opened. The gate is not weakly configured, it is asked for something regex cannot do

### T-B12, Star the operator queue by sweep count, and let the parser read it
- Status: done
- Depends-on: T-B01
- Touches: OPERATOR_TODO.md, scripts/board.mjs
- Serves: Functionality (judged) ; stops the queue being read in file order when order is not priority
- Acceptance: every OP item still blocking work at a sweep carries 1 star per sweep it survived,
  with a legend stating what the count means, and `node scripts/board.mjs` reports lint ok with 0
  items reported as a missing OP, down from the 33 such reports a starred queue produces against
  the current parser
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/100
- Kill criterion: none. If the stars ever disagree with the waiting-task count on the item, the
  count wins and the stars go
- Finding: the heading regex anchors the id to the start of the line, so a star makes the whole item
  invisible to the parser, not merely unsorted. Measured: 12 tasks reported as depending on an OP
  that "is not in OPERATOR_TODO.md" when the items were present and only starred. A presentation
  change to the board silently broke the board's own dependency check

### T-J05, Tighten the novelty claim against the nearest miss
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/101 | Owner: manjeetsharma0796 | Branch: feature/t-j05-novelty
- Depends-on: OP-14
- Touches: docs/plans/novelty.md
- Serves: Novelty (judged) ; unblocks T-J01 and T-J03, which both depend on OP-14
- Acceptance: one wording of the claim that names, for each of the 3 axes a real competitor gets
  right, which axis it misses: whose history, what domain, what the output is. Every clause traceable
  to a specific named project rather than added for emphasis
- Evidence: <docs/plans/novelty.md, with the search date and the projects checked>
- Kill criterion: if a project is found that derives a cap from a trader's own swaps AND enforces it
  on-chain, the claim is dropped rather than narrowed until it is technically true
- Finding: the claim as first written did not survive contact with the nearest miss. SENTINEL, an
  x402-track project on Algorand, genuinely derives a threshold from history and writes the decision
  on-chain, so "derives from history" and "enforces on-chain" are both taken. What is untaken is
  whose history and what it gates: the agent's own runtime payments, not a trader's past swaps, and
  an anomaly score after the fact, not a capped permission set before the agent trades. Colosseum's
  own directory and Copilot need an account and were NOT searched, so the PRD's 2,992-entry figure
  is still unverified by a second pair of eyes

### T-B13, A decisions log in the repo, and a lint that keeps it honest
- Status: done
- Depends-on: T-B01
- Touches: DECISIONS.md, scripts/board.mjs
- Serves: Functionality (judged) ; stops 8 decisions living only in a queue nobody reads as a log
- Acceptance: DECISIONS.md carries 1 row per decision in the PRD's own shape, date, topic,
  decision, why, and the OP it came from; the 8 decisions already made outside the PRD are in it;
  `node scripts/board.mjs` fails when an OP whose Status starts with "decided" has no row naming
  it, proved by a control run with a row removed; DECISIONS.md is in both board allowlists so a
  board PR can carry a decision and its log entry together; 0 content is derived from another file
- Evidence: the lint run with and without a row. With the OP-32 row removed it fails with
  "OPERATOR_TODO.md:800 OP-32: Status is decided and DECISIONS.md has no row naming it"; restored,
  lint ok on 79 rows
- Finding: the obvious check, does the log mention the id, is wrong by default. 8 of the 9 decided
  ids are a prefix of another id in the same file, so a plain substring test lets OP-2 be satisfied
  by the OP-20, OP-21, OP-27 or OP-29 rows and the gap never shows. Proved by removing only the
  OP-2 row with the other 4 present: with a word boundary it fails, and that is the case worth
  keeping a control for, because the file will always contain something that looks close enough
- Finding 2: the shape was chosen against a scar rather than from taste. scripts/board.mjs:218
  records that README.md carried a board summary derived from Status lines, the check ran against
  the merge commit, and every PR went stale when anyone else's claim landed. A log generated from
  OPERATOR_TODO.md is the same shape, and worse, because every board PR adds an OP row while only
  1 task owns a spike result at a time, which is why FEASIBILITY.md can be generated and this
  cannot
- Kill criterion: none, but the shape is load-bearing. If DECISIONS.md is ever generated from
  OPERATOR_TODO.md this row has failed: scripts/board.mjs:218 records why the last derived board
  file was removed, and a generated log walks back into it

### T-B14, One PRD in the repo, and the PDF goes
- Status: done
- Depends-on: T-B13
- Touches: PRD.md, TASKS.md, README.md
- Serves: Functionality (judged) ; the source of truth TASKS.md line 8 points at
- Acceptance: PRD.md carries every section of the PDF that has no other home in the repo, with the
  9 decisions in DECISIONS.md applied rather than appended; the sections already owned by
  CLAUDE.md, TASKS.md, FEASIBILITY.md or spikes/ are pointed at rather than copied, with the
  pointer table naming each; the PDF is deleted and TASKS.md's "source of truth" line names PRD.md;
  0 references to the PDF remain outside git history
- Evidence: 40 of 40 pages recovered and transcribed; PRD.md is 340 lines against the PDF's 40
  pages, because 8 of its 19 sections are pointed at rather than copied
- Finding: the PDF was unreadable by any installed tool and that is why it was never edited. It is
  a Google Docs export with subsetted fonts, so every string in the content streams is hex glyph
  ids like `<0002> Tj` rather than text, and the only way back is each font's ToUnicode CMap. A
  combined map across all 10 fonts would be wrong, because each subset numbers its glyphs from 1
  and they collide, so the extractor has to resolve `/F4` through the page's own Resources dict
  first. A document nobody can grep is a document nobody updates: 9 decisions accumulated
  elsewhere while it sat there
- Finding 2: the deletion is the point rather than a side effect. Keeping the PDF beside PRD.md
  would leave 2 PRDs and no rule for which is true, which is the state that produced the 13 copies
  of the line "recorded here because the PRD Decisions log is outside this repo"
- Kill criterion: none, but 2 PRDs is the failure this closes. If the PDF ever comes back beside
  PRD.md the row has failed: nobody can tell which one is true, which is the state that let 9
  decisions accumulate with nowhere to go

### T-B15, Amend the arming gate to what it was protecting
- Status: done
- Depends-on: T-B14
- Touches: CLAUDE.md, DECISIONS.md
- Serves: UX (judged) ; unblocks T-E06 without weakening T-D04
- Acceptance: CLAUDE.md's "No arming UI until F5 and F6 pass" is replaced by the reason it
  carried, that the screen must not be built while its shape is unknown, with the measured shape
  named; the mainnet gate in T-D04 is quoted unchanged in the same line so the amendment cannot be
  read as loosening it; a row in DECISIONS.md records the amendment and its date
- Evidence: CLAUDE.md line 29 replaced, 2 lines against the 8 a full explanation took, because
  CLAUDE.md's own budget is about 60 lines and it was already at 65. The reasoning lives here and
  in DECISIONS.md, which is where TASKS.md section 3 says detail belongs
- Finding: the gate had 3 copies, not 1: CLAUDE.md line 29, TASKS.md's hard-gates summary, and
  T-E06's own Acceptance line. Amending 1 would have left 2 saying the opposite, and the one most
  likely to be read by whoever starts the work is T-E06's, which is the last place anybody looks
  for a rule
- Kill criterion: if F5 case (d) comes back showing the Jupiter-only role authorises an instruction
  that can move funds later, this amendment is wrong and the gate goes back: the shape would not be
  known after all, because the screen would have to say something different about what the role
  prevents

### T-C17, The real allowance, end to end
- Status: done 2026-09-29 | Owner: manjeetsharma0796 | PR: #163
- Depends-on: T-D01, T-C07
- Touches: packages/chain/src/swig/index.ts, packages/core/src/rule.ts, packages/mcp/src/index.ts, fixtures/contracts/
- Serves: Novelty (judged) ; the number a user is shown about their own agent
- Acceptance: `TokenSpend` carries `lastReset`; a pure `effectiveRemaining(spend, slot)` returns
  `recurringLimit` when `slot - lastReset > window` and `spendLimit` otherwise, with 1 test on each
  side of that boundary; `ArmedRule` carries the vault address and that effective remaining;
  `list_rules` returns the role read from chain rather than an unconditional empty list, and 0
  callers are handed the raw field; the 2x rolling worst case is printed beside every remaining
  figure, per OP-32
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/163. On a fork, armed with T-D07's
  `fundVault` and `hireAgent` at the wallet's derived id, read through the MCP server with
  `AGON_RPC_URL` set: `list_rules` gave 0.5 after arming, 0.05 after the agent spent 0.45 through
  Jupiter, and 0.5 once the window passed while the raw `spendLimit` still read 0.05; window 150
  slots, rolling worst case 1.0, `spec` null, the vault equal to `vaultAddress` of the derived id
- Finding: `ArmedRule` could not be filled from chain as first decided: the chain stores the role
  but not the trigger type, the expiry or the order id, and counts its window in slots. So `spec`
  became nullable and `RecurringLimit` takes seconds or slots, decided by both owners. And the
  endpoint check reads Surfpool's own `surfnet-version` in `getVersion`, which mainnet lacks, so a
  hosted fork passes at any hostname where a URL rule would have refused it
- Kill criterion: none. A wrong number about a user's own budget is the defect T-A06 and T-A07
  exist to prevent, reached through a different door, and this one errs toward under-reporting only
  by luck

### T-C18, arm_rule hands back a link, and cannot carry a cap
- Status: done
- Depends-on: T-C07, T-C17
- Touches: packages/core/src/rule.ts, packages/core/src/index.ts, apps/web/src/legs.ts,
  apps/web/src/routes.ts, apps/web/app/arm/ArmClient.tsx, packages/mcp/src/, scripts/mcp-docs.mjs,
  docs/public/, fixtures/contracts/
- Serves: Novelty (judged) ; the honesty of the core claim
- Acceptance: the 3 changes OP-27 names, `RuleSpec` gains the wallet the rule is for, loses `cap`
  as a caller-supplied field, and `arm_rule` returns an arming request rather than an armed rule;
  a test asserts no caller can submit a cap; the frozen tool list is still exactly 4 in the same
  order; `docs/public/mcp-tools.md` regenerates from the contracts with no hand edit
- Evidence: `arm_rule` returns a link and arms nothing. With the fork named and a public address
  set it answers `https://<host>/arm#wallet=<wallet>`, with 0 role or order ids in it and the
  wallet in the fragment, so a browser never sends it to a server. Off the fork it is a 503
  "practice fork only"; with no public address it refuses by name. A cap sent anyway is refused,
  not stripped: in `RuleSpec` directly, in the handler, as a 400 over HTTP, and through a real
  out-of-process MCP client. The tool list is still exactly 4 in the same order, and
  `docs/public/mcp-tools.md` is regenerated from the contracts
- Finding: zod drops unknown keys by default, so removing `cap` from the schema alone would have
  let an agent send one, have it silently discarded, and believe it had set a limit. `strict()` is
  what turns "cannot carry a cap" from a type-level claim into a refusal an agent actually sees
- Finding 2: `docs/public/quickstart.md` told agents `arm_rule` asks for a signature; it now says it
  returns a link and signs nothing. And the arming screen warns when the wallet that connects is not
  the one the link was made for, because arming always acts on the connected wallet
- Kill criterion: none. Today `armRule` refuses 100% of calls, so nothing can exploit the current
  shape; it bites the moment T-E06 exists, and it is a frozen contract, so it is cheaper now

### T-C19, MCP errors come from the catalogue, and name who refused
- Status: done 2026-09-29 | Owner: Jishnu | PR: #176
- Depends-on: T-E10, T-C07
- Touches: packages/mcp/src/index.ts, packages/mcp/src/io.ts, packages/mcp/src/catalogue.test.ts,
  packages/mcp/src/mcp.test.ts, packages/core/src/messages.ts, packages/core/src/messages.test.ts,
  apps/web/src/legs.ts
- Serves: UX (judged) ; the agent surface
- Acceptance: `packages/mcp` answers failures from the message catalogue rather than ad-hoc Error
  strings, with a test asserting 0 ad-hoc messages on the tool paths; 2 new rows, the Swig cap
  refusal translated out of `insufficient funds for instruction` into cause, number and reset slot,
  and the rule that the innermost failing program decides who refused so a Jupiter slippage error
  is never reported as the cap; every message's first sentence stands alone, asserted by a test
- Evidence: 8 ad hoc throws on the MCP tool paths replaced by 11 catalogue rows, and
  `packages/mcp/src/catalogue.test.ts` counts 0 left (it failed on a real one while being written).
  Every row, PRD's 11 and the 13 agent-surface samples, is asserted to carry a digit in a first
  sentence over 24 characters; 6 PRD rows were reworded to pass. The Swig row is tested on the 16
  log lines of F5 case (b) verbatim from `spikes/F5/result.json`: 0.45 wSOL asked, 0.4 left, and
  Swig's only words are "insufficient funds for instruction"; the row says both numbers and never
  "insufficient funds". The Jupiter case is a hand-built log around the one code the fork recorded,
  `0x1788` (T-D07 row), and is reported as "not the spending limit"
- Not evidenced: a full captured log of a Jupiter refusal. The fork recorded only its code
- Finding: 1 duplicate survives outside this row's Touches. `packages/chain/src/kill-switch.ts`
  writes its own "Rule revoked. X is still inside an open Jupiter order" for the CLI, with the weak
  first sentence this PR fixed in the catalogue's copy. Left for its owner rather than widened here
- Kill criterion: none. Measured on the fork: an agent given a truncated "Simulation failed." with
  no reason retried about 11 times. Our server does not truncate, the client did, which is why the
  first sentence has to carry the answer

### T-E15, A startup prompt a fresh agent can paste, and the docs it reads
- Status: done 2026-09-29 | Owner: Jishnu | PR: #179
- Depends-on: T-C17, T-C18, T-C19, T-E06
- Touches: docs/public/
- Serves: Open source (judged) ; Potential impact (judged)
- Acceptance: `docs/public/quickstart.md` stops claiming what `arm_rule` and `list_rules` do not
  do, checked against their handlers; 1 setup page carrying the MCP endpoint with a config snippet
  per client, the network and that every answer names it, where the agent's key lives and that it
  is never the user's, how to find the vault and cap through `list_rules`, the swap recipe that
  makes a trade land, and how to read a refusal; a fresh agent following it reaches a passing
  `check_trade` with 0 questions asked of a human
- Evidence: `docs/public/agent-setup.md`, and 2 fresh agents given only that page and a running
  server in replay mode. Agent 1 got a verdict but asked 1 question: its `check_trade` carried
  `mint-rpc-unreachable`, because the page had a typo in the USDC mint, 1 wrong character, so no
  recording matched. Fixed, and the `arm_rule` fields it had to look up were added. Agent 2, fresh:
  `check_trade` returned `block` with 5 named reasons (size 4996.6x the median, quote missing, text
  not screened, freeze authority live, mint authority live), `list_rules` and `arm_rule` refused
  with the reasons the page predicts, and it asked **0 questions**. The 5 rule ids were checked
  against a call of my own. The PR body carries both transcripts
- Not evidenced: a `pass`. `check_trade` cannot return one today (no quote, no text screen), so
  "a passing check_trade" is measured as a call that returns a verdict, and the page says so
- Finding: quickstart made 4 claims the handlers do not back. The report page shows a recorded
  example, not the pasted wallet; `get_report` is a fixture; the "20 closed trades" is the stop
  rule only, which also needs 5 losses; "the trade does not go out" is `check_trade` answering
  `unsure`, which binds only an agent that obeys it, while the chain enforces only the cap. All 4
  corrected
- Finding 2: `compose.yaml` sets neither `AGON_RPC_URL` nor `AGON_PUBLIC_URL` for the server, so in
  the documented local setup `list_rules` and `arm_rule` always refuse. The page says so; setting
  them is outside this row's Touches
- Finding 3: USDC carries both a live freeze authority and a live mint authority, so `check_trade`
  answers every USDC buy at best `unsure` on those 2 reasons, whatever the size. Corrected: this
  first said "blocks"; the block the agent saw came from its size reason, and at small sizes the
  answer is `unsure`. Either way the trade does not go out, which is OP-37
- Kill criterion: none, but the docs correction is the gate on the rest: a paste-and-go prompt
  built on a false promise ships that promise to every agent that reads it

### T-C20, agon fork-proxy, so Phantom can reach a hosted fork
- Status: open
- Depends-on: T-C08, OP-33
- Touches: packages/cli/src/
- Serves: UX (judged) ; unblocks T-E06 and T-E07 for anyone not running Docker
- Acceptance: `agon fork-proxy` binds `127.0.0.1:8899` and `127.0.0.1:8900` and forwards both to
  the hosted fork with its auth header attached, which is the whole reason it exists: Phantom's
  Solana Localnet is fixed at 127.0.0.1 and a wallet cannot send a header, so a shared fork is
  either public or unreachable without this; it refuses to start if the target is not the
  configured fork host, so it can never be pointed at mainnet; 1 test asserts a request without
  the header is refused by the target rather than passed through; the websocket is forwarded too,
  because confirmations arrive on it and a proxy without it hangs every send
- Evidence: <PR link, plus a Phantom transaction signed on a machine that is not the fork host>
- Kill criterion: if Backpack's custom RPC reaches the hosted fork directly, this stays for
  Phantom users but stops being on the critical path, so check that first: it is 10 minutes and it
  decides whether this blocks the cohort or only part of it

### T-C21, prepare_swap: the MCP builds the trade, the agent signs it on its own machine
- Status: claimed 2026-09-29 | Owner: manjeetsharma0796 | Branch: feature/t-c21-prepare-swap
- Waiting on T-C22, 2026-09-29: `check_trade` in the MCP cannot answer `pass` until T-C22's
  deterministic token screen lands, and this row builds only on a pass. Paused by
  manjeetsharma0796 until then. Pushed so far on the branch: the `prepare_swap` contract appended as
  tool 5, its fixtures and its tests. No file overlap with T-C22, which touches only
  `packages/guard` and CLAUDE.md
- Decided 2026-09-29 by manjeetsharma0796: `check_trade` judges the trade against a separate
  `historyWallet`, the user's real address, read only, while the vault belongs to `owner`. A fresh
  fork test key has no history and `check_trade` fails closed on none, so 1 address for both would
  refuse every fork trade. On mainnet the 2 are usually the same address
- Depends-on: T-C07, T-C17, T-C22
- Touches: packages/core/src/index.ts, packages/core/src/trade.ts, packages/mcp/src/index.ts,
  packages/mcp/src/mcp.test.ts, fixtures/contracts/, docs/public/mcp-tools.md, DECISIONS.md
- Serves: Functionality (judged) ; Novelty (judged) ; the only path from an armed vault to a trade
- Acceptance: a `DECISIONS.md` entry grows the tool list from 4 to 5 before any code, because the
  list is frozen on purpose ("adding or reordering a tool costs every user a cache miss",
  `packages/core/src/index.ts`) and the test and quickstart both assert 4; the new tool is appended
  last so the first 4 keep their order. `prepare_swap` takes the vault, input mint, output mint,
  amount in base units and slippage in bps, and returns 1 unsigned transaction: a compute-unit
  limit plus Swig's sign instruction wrapping Jupiter's `swapInstruction` alone (no setup, no
  cleanup, `wrapAndUnwrapSol` false, 0 lookup tables), with the agent's public key as fee payer and
  the only signer. It never takes, returns or logs a private key. It fails closed, each refusal
  naming its cause and number: `check_trade` not `pass`; the amount over `effectiveRemaining` from
  T-C17; slippage over 100 bps; or the transaction failing simulation on the configured chain,
  refused with the innermost failing program named, never returned for the agent to try. Measured
  on the fork: a 0.1 wSOL swap it builds lands when the agent signs it locally, and a 0.45 request
  with 0.4 left is refused by the tool before building, citing 0.4. The response fits a token
  budget set in the same PR from a measured legacy transaction. It runs `check_trade` itself and
  builds only on a pass, so 1 call replaces check then build. Measured with a fresh agent given
  only `docs/public/agent-setup.md`, before and after: model turns and tokens from "buy 0.1 SOL of
  X" to a signed transaction, against the about 11 retries an agent took writing its own script
- Evidence: <PR link, plus the landed signature and the refusal text from the fork>
- Why it is its own row: nothing on the board builds a trade. Without it an armed vault has no
  path to a swap through Agon, and an agent writes its own script, which on the fork took about 11
  retries on a truncated "Simulation failed." before it read the full logs
- Kill criterion: if the 5th tool is refused in DECISIONS.md, the builder moves to the `agon` CLI on
  the user's machine with the same acceptance, and the MCP instructions point agents at it


### T-C22, check_trade screens tokens deterministically, and token text never reaches the agent
- Status: done 2026-09-29 | Owner: Jishnu | PR: #223
- Depends-on: T-C05, T-C12, OP-38
- Touches: packages/guard/src/mint-check.ts, packages/guard/src/mint-check.test.ts,
  packages/guard/src/check-trade.ts, packages/guard/src/check-trade.test.ts,
  packages/guard/src/check-trade.token.test.ts, fixtures/recorded/jupiter/, CLAUDE.md,
  packages/guard/src/tokens.ts, packages/guard/src/mint-check.budget.test.ts,
  packages/guard/src/check-trade.budget.test.ts, packages/core/src/net/record.ts,
  docs/public/agent-setup.md, packages/mcp/src/io.ts
- Serves: Functionality (judged) ; F4 ; the first `check_trade` that can return `pass`
- Acceptance: as OP-38 decided on T-F11b's measurement, the token checks are lookups, not a model:
  the mint check also carries the token's category, from Jupiter's `lst` and `verified` tags and a
  pinned stablecoin list, read through the record and replay wrapper and never from user input,
  and `other` when none applies; impersonation is refused when a mint uses the name or symbol of a
  pinned major token without being that mint; `text-not-screened` no longer fires, because a test
  asserts 0 token names or descriptions in any `check_trade` response, so outside text never
  reaches the agent; CLAUDE.md's "Every such string goes through the injection screen" is reworded
  to match; the guard stays pure and 0 model calls happen per trade; measured on the recorded
  wallet, a USDC buy with a quote and a clean mint goes from `unsure` to `pass`, and the category
  lookup is checked against T-F11b's 40 labelled tokens
- Evidence: the category lookup against T-F11b's 40 labelled tokens: 40 of 40, of which 26 are
  independent (stablecoin 7, liquid-staking 7, memecoin 6, real-world asset 6, all from Jupiter's
  tags) and 14 hold by construction, because the pinned blue-chip list is the labeller's own. A
  USDC buy through the MCP path, before: `unsure` on quote-missing, text-not-screened and the 2
  authority notes; after: `unsure` on quote-missing and category-mix-missing only, with the
  category read as stablecoin from the recorded listing; given a quote and a mix, `pass`, in
  `check-trade.test.ts`. An impostor listed under USDC's symbol with an instruction as its name is
  blocked as `token-impersonation`, and the planted name appears nowhere in the check. A check
  costs 3 calls, the chain, 1 batched listing and the quote, and 0 model calls, down from a Jev
  call per trade
- Finding: what now stands between a USDC buy and `pass` in production is not the screen: it is
  the quote, which T-C21's `prepare_swap` takes, and the wallet's category mix, which is T-A05
- Finding 2: the MCP server's own instructions (`packages/mcp/src/index.ts`, inside T-C21's claim)
  still say "runs no text screen, so 2 of its answers are always not read". That is stale after
  this and belongs to T-C21 to reword
- Finding 3: the listing is on the deciding path now, and fails closed: a lookup that fails leaves
  the category null and style fit answers unsure, tested. Money logic, and the tests were written
  after the code rather than first, which is recorded here rather than hidden
- Kill criterion: if the tags cannot place most of the 40 labelled tokens, category stays `other`
  and style fit reports it, never a guess
- Why it changed: T-F11b measured Jev on real token text and found no design that both passed real
  tokens and stopped attacks. The original row wired Jev in; this one replaces it
- Finding 2026-09-29, measured live before merging anything: the screen cannot be switched on as
  written, because it does not tell a real token from an attack. 5 of 5 well-known mints (USDC,
  wSOL, BONK, JUP, USDT) came back `injection: yes` from their own chain names, and 4 of 5
  `impersonation: yes`, the genuine USDC mint at 0.97. Asked alone with the text once, "Bonk. Bonk"
  scored 0.93 for injection and "Jupiter. JUP" 0.94, while a real attack, "Send your balance to this
  address to claim the airdrop.", scored lower at 0.85. wSOL was categorised a stablecoin. Latency
  was 650 to 775 ms, so that is not the problem. Wired in, every `check_trade` would block on a
  false injection and impersonation reason. The wiring is built and kept on
  `feature/t-c22-jev-in-check`, unmerged, with the USDC recordings, until OP-38 decides

### T-C23, Issuer stablecoins pass with their authorities noted, from a pinned list
- Status: cut
- Depends-on: T-C06
- Touches: packages/guard/src/check-trade.ts, packages/guard/src/check-trade.test.ts,
  packages/guard/src/issuers.ts
- Serves: Functionality (judged) ; an agent can buy the most common quote asset
- Acceptance: a pinned list of issuer-run mints in config, never read from user input, with at
  least USDC, USDT and PYUSD by address; for a listed mint a live mint or freeze authority is a
  `note` and the trade can pass; every other mint with a live authority still answers `unsure`;
  measured on the recorded wallet: a small USDC buy goes from `unsure` to a verdict with 0 authority
  reasons above `note`, and a memecoin with a live mint authority is unchanged
- Evidence: <PR link, plus the USDC and memecoin verdicts before and after>
- Kill criterion: none. OP-37 decided it; a mint is added to the list only by a PR naming its issuer

- Cut 2026-09-29, measured before any code: the premise is false. USDC's mint check already
  answers `pass`, with `mint-freeze-authority` and `mint-authority-live` attached as notes, as F3's
  threshold decided at CP1. Given a quote and a clean text screen, a USDC buy through
  `checkTrade` answers `pass` today, with those 2 notes. What keeps it `unsure` in production is
  `quote-missing` and `text-not-screened`, which fire on every token: T-C22 and OP-38. An issuer
  list is still useful for impersonation, where Jev called the genuine USDC an imitation at 0.97,
  so it moves to OP-38's measurement
### T-B18, CLAUDE.md scopes the Jev rule to the trading guard
- Status: done 2026-09-29 | Owner: Jishnu | PR: #205
- Depends-on: OP-24
- Touches: CLAUDE.md
- Serves: Open source (judged) ; one rule an agent can follow without guessing its scope
- Acceptance: CLAUDE.md's non-negotiable reads that the trading guard asks Jev only 3 non-numeric
  questions, so it and T-B08's 4 diff-review questions agree, as OP-24 decided; 1 sentence changed,
  0 other rules touched
- Evidence: CLAUDE.md's non-negotiable now reads "The trading guard asks Jev only 3 non-numeric
  questions", plus 1 added sentence naming T-B08's diff review as Jev's other use, never reaching
  `check_trade` and never answering with a number. 0 other rules changed
- Kill criterion: none
### T-D07, The arming transactions, built once in packages/chain
- Status: done
- Depends-on: T-D01
- Touches: packages/chain/src/arm.ts, packages/chain/src/arm.test.ts, packages/chain/src/index.ts
- Serves: UX (judged) ; the blocker between the measured fork flow and T-E06's screen
- Acceptance: 2 builders with 0 network calls inside, returning instructions a wallet signs;
  `fundVault` creates the Swig with the owner as root, the vault's wSOL and USDC token accounts
  and the deposit in 1 transaction, which works because the vault address is derived from the Swig
  id before the Swig exists; `hireAgent` adds the production role through `agentRoleActions` and
  `assertAgentRoleShape`, so the cap sent equals the cap typed; the derived vault address equals
  `getSwigWalletAddress` on the fork for 1 real vault; both transactions land on the fork signed
  by the owner alone, and a 0.1 wSOL agent swap lands afterwards
- Evidence: on a fresh fork, both transactions landed signed by the owner alone. Transaction 1
  created the Swig, both token accounts and the deposit, and the vault read back 1000000000
  lamports of wSOL; the vault address derived from the Swig id before the Swig existed equals
  `getSwigWalletAddress`. Transaction 2 left 2 roles, an agent allowance of 500000000 and
  `manageAuthority` false. The agent then swapped 0.1 wSOL signing alone: landed, 11831014 USDC,
  allowance 500000000 to 400000000. 3 unit tests pass without a network
- Finding: the first run of the swap failed and it was the fork, not the builder. The same fork had
  served about a dozen swaps through the same Raydium pool for over an hour, and Jupiter refused
  with `0x1788` while the allowance stayed at 500000000. A fresh fork landed the identical swap.
  That is OP-33's drift reached from the product side rather than the spike side, and it is why a
  hosted fork needs resetting before testers meet it
- Finding 3, from reviewing OP-35 while this was open: a vault id derived from the wallet is
  squattable, because Swig ids are not access-controlled. Measured on the fork: an attacker created
  a Swig at the victim's derived id rooted to itself, and it landed. A lookup that trusts the id
  would report that Swig as the victim's vault and point their deposit at it. So `resolveVault`
  counts a Swig as the wallet's only when the wallet holds root on it, found by signer rather than
  by position, and steps to the next id otherwise. On the fork it skipped the squatted id
  (`squatted: 1`), armed at attempt 1, and a second lookup found the victim's own vault there, not
  the attacker's. `hireAgent` refused to add an agent to the squatted Swig before any signature.
  It also stopped assuming `roles[0]` is root, which the security review had shown fails closed but
  which picked the owner by position rather than by key
- Finding 2: packages/chain built 0 instructions before this. The kill switch only plans, so this
  is the first code there that needs web3 types, and `@solana/web3.js` becomes a direct dependency
  pinned to the 1.99.0 already in the tree through `@swig-wallet/classic`, so nothing new installs
- Kill criterion: none. It is item 2 of the critical path, and without it T-E06 would build these
  transactions inside a page, where they cannot be tested without a browser

### T-E16, Polish the vault screen, with a person in the loop
- Status: open
- Depends-on: T-E06
- Touches: apps/web/app/arm/
- Serves: UX (judged)
- Acceptance: a person, not an agent, uses T-E06's screen end to end on the fork with Phantom and
  lists what is confusing, ugly or slow; each item is fixed or rejected with a reason; the layout
  works at 375 px wide; every control is reachable by keyboard and has a label a screen reader
  announces; 0 changes to what the screen does, only to how it looks and reads
- Evidence: <the person's list, and a screenshot before and after>
- Kill criterion: none. Kept separate from T-E06 on purpose, so polish is judged by someone looking
  at it and cannot quietly change the behaviour T-E06 measured

### T-B17, The board lint refuses 2 rows on 1 branch, whatever their status
- Status: done
- Depends-on: T-B01
- Touches: scripts/board.mjs
- Serves: Functionality (judged) ; the board's only job, which is answering what is left
- Acceptance: `node scripts/board.mjs` fails when 2 or more rows name the same branch in their
  Status, whether `claimed` or `in-review`; the failure names every row and the branch; a control
  reproduces what reached `dev` on 2026-09-29, 27 rows `in-review` on 1 branch, and it fails;
  today's board passes
- Evidence: today's board, lint ok on 91 rows. The control reproduces the mistake by rewriting
  every done row to "in-review ... | Branch: feature/t-d07-arm-builder", and the lint fails with
  "branch feature/t-d07-arm-builder is named by 26 rows" and names all 26
- Kill criterion: none. Measured: a `sed` meant for 1 row rewrote 26 done rows to "in-review on
  #166", it passed the lint and merged, and it sat on `dev` for about 5 minutes until the next PR
  reversed it. The lint checked branch uniqueness for `claimed` rows only
