# TASKS.md, the Agon board

The board and the lock. Nothing else is the board: not an issue tracker, not a chat message.

**If you are an agent or a person about to write code, read sections 1 to 3 first. They are the
whole protocol. Then claim exactly one task and work only on that task.**

Source of truth for scope, numbers and dates: `Agon PRD: hackathon build with feasibility
gates`. Every acceptance number here is copied from it verbatim. If a number here disagrees
with the PRD, the PRD wins and you fix this file in the same commit.

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
| P1 | 09-25 to CP1 | A: T-A01, T-F01a. B: T-B03. C: T-C04, T-F03, T-C05, T-F11a. D: T-D01, T-F05a, T-F05b, T-F06a. E: T-E03 |
| P2 | CP1 to CP2 | A: T-A02, T-A03, T-A04, T-F01b, T-F02. B: T-F09, T-B04, T-B08. C: T-C06, T-C07, T-C08, T-F04, T-F11b. D: T-D02, T-D03, T-F05c, T-F06b, T-F07. E: T-E04, T-E05, T-E10, T-E12 |
| P3 | CP2 to CP3 | B: T-B05. C: T-C09. D: T-D04. E: T-E06, T-E07, T-E08, T-E09 |
| P4 | CP3 to 10-11 | T-J01, T-J02, T-J03 |
| P5 | Fall, CP4 to CP6 | T-F08, T-F10, T-F11c, T-B06, T-B07, T-C10, T-D05, T-E11, T-J04 |

Two hard gates from the PRD: **no arming UI until F5 and F6 pass** (T-E06 depends on both),
and **no mainnet transaction until the pre-mainnet checklist is ticked** (T-D04).

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
- Status: claimed 2026-09-24 | Owner: manjeetsharma0796 | Branch: feature/t-c01-frozen-contracts
- Depends-on: T-B01
- Touches: packages/core/, fixtures/contracts/
- Serves: Functionality (judged) ; 5 tracks in parallel from day 2
- Acceptance: 3 contracts defined exactly once, (1) check_trade input mint/side/size/wallet and output verdict plus reasons each carrying a rule name and a number, (2) report JSON with metrics, rules, exceptions and their cost, coverage share, unsupported transactions, (3) rule spec consuming mint set, cap, window, trigger type, expiry and producing a Swig role plus a Jupiter order id; that 1 definition generates the MCP tool schemas, API validation, frontend types and fixture checks, proven by 1 deliberate shape change failing in all 4 places
- Evidence: <PR link showing 4 failures from 1 edit>
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
- Status: blocked, see OP-17
- Depends-on: T-C01, T-C02
- Touches: apps/web/app/report/, apps/web/app/api/, packages/mcp/src/index.ts
- Serves: Functionality (judged) ; UX (judged)
- Acceptance: on staging, pasting an address returns a report built from fixtures, `check_trade`
  returns a fixture verdict, and arming is a no-op on devnet; all 3 legs work end to end by day 2,
  so integration bugs show on day 2 and not day 18
- Evidence: <staging URL, plus the 3 legs in a recording>
- Kill criterion: none. Monad's worst bugs only appeared end to end (T1.7, T6.8)

### T-A01, Balance-change decoder
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/23
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

### T-F01a, F1 spike on 2 wallets, for CP1
- Status: blocked, see OP-23
- Depends-on: T-A01
- Touches: spikes/F1/, scripts/board.mjs
- Serves: Functionality (judged) ; CP1 gate
- Acceptance: on 2 wallets, 50 of 50 randomly sampled transactions classified correctly, amounts
  exact to base units, realised P&L within 1% of a hand-computed FIFO ledger; share of swaps
  decoded recorded per wallet, below 95% is a checkpoint finding and not a pass
- Evidence: <spikes/F01/result.json at a commit>
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
- Touches: spikes/F03/
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
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/27
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

### T-F11a, F11 (a) and (b), Jev schema validity and latency
- Status: open
- Depends-on: T-C05, OP-4
- Touches: spikes/F11/
- Serves: Novelty (judged) ; CP1 gate
- Acceptance: 500 of 500 responses valid against our question schema; latency at 1, 5 and 20
  questions per call, 200 calls each, with p95 at 20 questions 500 ms or less and 20-question p95
  within 1.5x of 1-question p95
- Evidence: <spikes/F11/result.json at a commit>
- Kill criterion: fallback is an LLM guard with a stricter threshold, or Kev-0.5B locally

### T-D01, Swig role creation and removal in packages/chain
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/39
- Depends-on: T-C01
- Touches: packages/chain/src/swig/
- Serves: Novelty (judged) ; F5
- Acceptance: creates a role with `program = Jupiter` and `tokenRecurringLimit` and nothing
  else; the agent key holds 0 `manageAuthority`, verified by reading the role on-chain and not
  from our config; Swig and Jupiter program ids pinned in config, 0 read from user input;
  transactions built as v1 with `@solana/kit` 8.0.0 or later
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

### T-F05a, F5 spike, 7 cases on devnet
- Status: blocked, see OP-20
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

### T-F05b, F5 route size, 20 Jupiter routes against the v1 limit
- Status: open
- Depends-on: T-D01, OP-3
- Touches: spikes/F05/route-size/
- Serves: Functionality (judged) ; CP1 gate
- Acceptance: 20 real Jupiter routes of increasing complexity wrapped in a Swig execute
  instruction; 18 or more of 20 fit the v1 limit (4,096 bytes, at most 64 accounts, all inline, no
  address lookup tables); the legacy 1,232-byte count is recorded for reference and is not a pass
  criterion
- Evidence: <spikes/F05/route-size/result.json at a commit>
- Kill criterion: fallback is lowering Jupiter `maxAccounts` until the route fits 64 inline accounts and measuring the price cost; a route still needing more than 64 accounts goes out as v0 with lookup tables inside 1,232 bytes

### T-F06a, F6 spike, Trigger order owned by a Swig wallet, in simulation
- Status: open
- Depends-on: T-D01, OP-3
- Touches: spikes/F06/
- Serves: Novelty (judged) ; CP1 gate
- Acceptance: in mainnet simulation, a Trigger V2 order is created with the Swig wallet (a
  program-derived address) as owner, a cancel returns funds, and the vault deposit reduces the
  Swig allowance by exactly the deposit
- Evidence: <spikes/F06/result.json at a commit>
- Kill criterion: fallback is our local daemon polling price and executing through Swig, and the UI must then say "runs while your computer is on". The pitch loses 24/7 execution

### T-B03, Benchmark harness on a pinned mainnet fork
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/15
- Depends-on: T-B01, T-E01
- Touches: benchmark/runner/, benchmark/arms/
- Serves: Functionality (judged) ; F9
- Acceptance: 1 command runs the whole benchmark from a clean checkout against a Surfpool
  mainnet fork pinned to 1 slot, so every run sees identical prices and accounts; arms and
  metrics read from the committed scenario files; CI fails if anything under `benchmark/` or the
  demo path reads a fixture marked `synthetic: true`
- Evidence: <PR link, plus 2 runs with identical verdicts>
- Kill criterion: fallback is publishing only the deterministic half (guardrail verdicts on fixed trades) and dropping the live-agent comparison

---

# P2, CP1 to CP2 (2026-10-02)

CP2 evidence required: F1 and F2 complete; F4; F5 in simulation; F6 on mainnet ($20 orders);
F7; F9 on 20 scenarios; F11 accuracy, adversarial and numeric-routing cases (c, d, e).

### T-A02, FIFO P&L ledger
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/64
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

### T-F01b, F1 spike complete, 5 wallets
- Status: open
- Depends-on: T-A02, T-F01a, OP-1
- Touches: spikes/F01/
- Serves: Functionality (judged) ; CP2 gate
- Acceptance: 3 team wallets plus 2 public wallets with 200+ swaps across at least 4 venues
  (Jupiter, Raydium, Orca, Meteora, pump.fun); 50 of 50 sampled transactions correct on every
  wallet, not on average; amounts exact to base units; P&L within 1% per wallet; every
  transaction either decoded or listed as unsupported with a named reason
- Evidence: <spikes/F01/result.json at a commit>
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
- Touches: spikes/F02/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: (a) on 20 trades exiting at an 8% loss plus 2 held to 20%+, the stop is found at 8%
  within 1 percentage point, exceptions counted as exactly 2 and their cost exact; (b) a
  random-exit ledger reports "no consistent stop rule"; (c) 2 runs on a real beta wallet give
  byte-identical output; a report for 2,000 transactions completes in 60 seconds or less including
  Helius pagination
- Evidence: <spikes/F02/result.json at a commit>
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
- Status: claimed 2026-09-24 | Owner: Jishnu | Branch: feature/t-c06-check-trade
- Depends-on: T-C04, T-C05, T-A03
- Touches: packages/guard/src/check-trade.ts
- Serves: Functionality (judged) ; F4
- Acceptance: every numeric check is arithmetic (size, stop distance, price band, slippage, style
  fit as a share over the user's category mix); 0 model calls when all guards resolve
  arithmetically, and the no-model share is measured and reported; at most 3 network calls per
  call (1 account batch, 1 quote, 1 Jev call), asserted by a counting wrapper in tests; every
  verdict names the rule and the number ("4.1x your median size of 0.8 SOL") and is stamped with
  its data slot and rule version; response stays inside the 400-token budget on the golden wallets
- Evidence: <PR link, plus the network-count and token-budget tests>
- Kill criterion: none, a failure here is a bug and not a feasibility problem

### T-F04, F4 spike, 20 scripted verdicts
- Status: open
- Depends-on: T-C06
- Touches: spikes/F04/
- Serves: Functionality (judged) ; CP2 gate
- Acceptance: 20 of 20 verdicts match the answers written down in advance (over usual size, past
  usual stop, new token outside the usual set, normal trade, and edge cases at exact thresholds);
  p95 latency 300 ms or less excluding the RugCheck call; each output names the rule and its
  number
- Evidence: <spikes/F04/result.json at a commit>
- Kill criterion: none needed, this is arithmetic

### T-F11b, F11 (c), (d) and (e), accuracy, adversarial and numeric routing
- Status: open
- Depends-on: T-F11a
- Touches: spikes/F11/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: on 100 labelled cases, 40 of them token categories, a better Brier score than both
  an LLM guard and a no-model baseline; on 30 adversarial cases (token descriptions, social
  links, webhook payloads, tool outputs carrying instructions aimed at the model) 0 cases where
  an injected instruction flips a verdict to "safe"; 20 numeric questions expected to fail, to
  confirm the routing rule
- Evidence: <spikes/F11/result.json at a commit>
- Kill criterion: if (e) passes unexpectedly, numbers still stay on arithmetic. 1 lucky run is not evidence

### T-C07, MCP server, 4 tools and a stable list
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/80 | Owner: Jishnu | Branch: feature/t-c07-mcp
- Depends-on: T-C06
- Touches: packages/mcp/src/
- Serves: Functionality (judged) ; Open source (judged)
- Acceptance: exactly 4 tools (`get_report`, `check_trade`, `arm_rule`, `list_rules`) in 1 stable
  list so prompt caches survive; token budgets enforced in tests on the golden wallets,
  `get_report` 2,000 and `check_trade` 400; every unsure or failed verdict hands back to the user
  with the reason and the numbers and 0 silent retries; `check_trade` is callable by any agent
  (Solana Agent Kit, GMGN agents) and that is proven with 1 third-party client
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/80, plus the third-party client transcript in the PR
  body. Measured on the fixture wallet the mcp and web suites already share: get_report 815 chars,
  about 204 tokens, 9.8x headroom under the 2,000 budget; check_trade 315 chars, about 79 tokens,
  5.1x headroom under the 400 budget. `check_trade`'s answer is still T-E03's fixture verdict, not
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
- Status: open
- Depends-on: T-D01, T-C06
- Touches: packages/cli/src/daemon/
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
- Evidence: <PR link, plus the deliberately-dropped-transaction test>
- Kill criterion: none. Anything that can move funds fails closed

### T-D02, Rule expiry without admin rights
- Status: blocked, see OP-19
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

### T-F07, F7 spike, pre-signed expiry
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/83 | Owner: Prithwish | Branch: feature/t-f07-presigned-expiry
- Depends-on: T-D02
- Touches: spikes/F07/
- Serves: UX (judged) ; CP2 gate
- Acceptance: first check Swig's protocol-level SDK for a native expiry field and record the
  answer; then the pre-signed removal lands after expiry and the next agent transaction fails; an
  earlier manual revoke still works and leaves the pre-signed transaction harmless; the agent key
  held `manageAuthority` in 0 of the runs
- Evidence: spikes/F7/result.json at a commit; clauses 2 to 4 need a funded devnet key, see OP-19
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
- Touches: spikes/F05/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: the same 7 cases pass against real mainnet accounts through `simulateTransaction`
  and a Surfpool mainnet fork, 0 unexpected successes; Swig rejects an over-cap swap and the
  user sees "This needs 3.2 SOL; 1.1 SOL left in this window, resets in about 4h 10m." with 0
  automatic retries at a smaller amount
- Evidence: <spikes/F05/result.json at a commit>
- Kill criterion: no fallback for the rejection cases. CP2 decides whether Agon ships read-only

### T-F06b, F6 spike on mainnet with $20 orders
- Status: open
- Depends-on: T-F06a, T-D04, OP-5
- Touches: spikes/F06/
- Serves: Novelty (judged) ; CP2 gate
- Acceptance: with $20 per order, a stop order that should fill is filled by the keeper when the
  price condition is met, a take-profit that should not fill does not, proceeds return to the Swig
  wallet, a cancel returns funds, and the deposit reduces the Swig allowance by exactly the
  deposit; an unfilled order shows Jupiter's order status and the trigger price against the current
  price, and never says "executed" before it is
- Evidence: <spikes/F06/result.json at a commit, plus the mainnet signatures>
- Kill criterion: fallback is the local daemon polling price, and the UI says "runs while your computer is on"

### T-F09, F9 spike, benchmark reproducibility
- Status: done
- Depends-on: T-B03
- Touches: spikes/F09/
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
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/79, Branch: feature/t-b08-jev-review
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
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/37
- Depends-on: T-B01
- Touches: .gitleaks.toml, .github/workflows/board.yml
- Serves: Functionality (judged) ; unblocks T-A01 and T-E10, and every later PR carrying a fixture
- Acceptance: the secret scan reports 0 findings on T-A01's 24 recorded addresses, and still reports
  1 finding for each of 2 planted secrets, an 88-character Solana secret key and a uuid api key
  inside a recorded request URL; the frozen-contract gate fires on 0 of 2 PRs that only add a module
  under packages/core, and on 1 of 1 that changes one of the 3 contract files
- Evidence: <the 4 measured scans and the 3 gate checks, in the PR>
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
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/32
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

---

# P3, CP2 to CP3, World's Fair freeze (2026-10-08)

CP3 evidence required: the loop works end to end on a team wallet; 10+ beta reports; benchmark
A v1 and benchmark B v1 published; "rule is right" at 70% or above across 10+ reports.

### T-D04, Pre-mainnet checklist, before team wallets touch mainnet
- Status: open
- Depends-on: T-F05c, T-F06a, T-D02, T-D03, T-C08, OP-5
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
- Status: open
- Depends-on: T-F05a, T-F06a, T-D01, T-D02
- Touches: apps/web/app/arm/
- Serves: UX (judged) ; Novelty (judged)
- Acceptance: **do not start this until F5 and F6 pass**, because the screen changes shape if
  either fails; the user's wallet signs the Swig role (`program = Jupiter`,
  `tokenRecurringLimit`) plus the Jupiter Trigger order in 1 flow; the cap our code sends is
  never higher than the number the user typed, asserted by a test; wallet connection is the only
  auth and there are still 0 accounts
- Evidence: <staging recording, plus the devnet role read>
- Kill criterion: if F6 fell back to daemon polling, the screen must say "runs while your computer is on"

### T-E07, Revoke from the wallet, live
- Status: open
- Depends-on: T-D03, T-E06
- Touches: apps/web/app/rules/
- Serves: Novelty (judged) ; UX (judged)
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
- Status: claimed 2026-09-24 | Owner: Jishnu | Branch: feature/t-c09-cli
- Depends-on: T-C07, T-C08
- Touches: packages/cli/src/
- Serves: UX (judged) ; Open source (judged)
- Acceptance: installs, registers the MCP server with the user's assistants and starts the
  daemon in 1 command; cold start under 300 ms, asserted in CI; published to npm with
  provenance
- Evidence: https://github.com/manjeetsharma0796/agon-dev/pull/76. `agon report` runs the whole
  path on a real wallet: 100 transactions read, 77 of 80 swaps decoded at 96%, 28 closed trades,
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
- Kill criterion: none, the MCP server is how any agent reaches the guard

### T-E08, Onboarding
- Status: open
- Depends-on: T-C09, T-E04
- Touches: apps/web/app/(onboarding)/, docs/public/quickstart.md
- Serves: UX (judged)
- Acceptance: a new user goes from the landing page to a report in 3 steps or fewer, measured
  on 5 beta users with 0 help from us; the quickstart and the MCP tool reference are in
  `docs/public/` so they reach the public repo
- Evidence: <5 timed walkthroughs>
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
- Status: in-review https://github.com/manjeetsharma0796/agon-dev/pull/68
- Depends-on: T-C04, T-F03
- Touches: packages/guard/src/mint-check.ts, packages/guard/src/mint-check.test.ts, spikes/F3/
- Serves: Functionality (judged) ; CP1 decision on F3
- Acceptance: with `mint-freeze-authority` out of the blocking set, the F3 spike measures 9 of 9
  seizure mints blocked, 0 of 11 blue chips blocked with cbBTC relabelled as the regulated issuer it
  is, and 0 of 10 fee-only mints blocked; USDC and USDT return verdict `pass` carrying a reported
  freeze-authority reason rather than no reason at all; the threshold in `spikes/F3/thresholds.json`
  is rewritten with a note naming who changed it and why, per the feasibility bar
- Evidence: <the re-run spikes/F3/result.json at a commit>
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
- Touches: spikes/F08/
- Serves: Potential impact (judged) ; CP4 gate
- Acceptance: seed 5,000 wallets with 50+ swaps in the last 90 days; full ingest in 24 hours or
  less within the Helius credit budget; rank correlation between the first and second half of each
  wallet's history of 0.5 or more; search p95 500 ms or less
- Evidence: <spikes/F08/result.json at a commit>
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
