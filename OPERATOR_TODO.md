# OPERATOR_TODO.md, the human-only queue

Things no agent can do: get a key, move money, talk to a person, record a video, decide a
licence. An agent that hits one of these writes the `OP-N` entry here, sets its task to
`blocked, see OP-N` in `TASKS.md`, and moves to another task.

**Never fake a credential, a verification or a measurement to look done.** A blocked task with
an honest `OP-N` is worth more than a green row with nothing behind it.

Stars in front of an item mean it was still blocking work when the board was last swept, and
one more is added each sweep, so the count says how often it has been asked for. The number of
tasks waiting is on the item itself: if the two ever disagree, the waiting count wins.

Entry format, and every entry says which task it unblocks:

```
### OP-0, One-line title (this block is the format, not a real item)
- Status: open
- Owner: <name>
- Needed by: <date>
- Unblocks: T-B02, T-J02
- What exactly: ...
- Done when: ...
```

Status values: `open` | `claimed <date> | Owner: <name>` | `done <date>: <result>` |
`dropped <date>: <reason>`.

---

### ** OP-19, Fund a throwaway devnet keypair
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-26, so F5 has a result before CP1 on 2026-09-27
- Unblocks: T-F05a, T-F05b, T-F06a, T-D02, T-D03, and through them T-E06, the arming UI,
  and every other task whose evidence is an on-chain read
- What exactly: 1 throwaway devnet keypair with **0.01 devnet SOL**. Not 2 SOL: the F5 run measured
  what the 7 cases actually cost and it is 1,543,680 lamports, 0.0015 SOL, which is 1,503,680 of
  rent for the 168-byte two-role Swig account plus 5,000 a transaction for 8 transactions. 0.01
  covers several reruns. That changes who can unblock this: it does not need a faucet with a big
  allowance, only somebody holding a dusting of devnet SOL. All 7 faucets reachable without a
  browser refuse, listed in `spikes/F5/result.json` under `funding.faucetAttempts`, and 0.1 SOL was
  refused as flatly as 1 SOL, so the limit is per day and not per amount. The web faucet at
  faucet.solana.com wants a browser and a captcha. Devnet SOL has no value, so this is not the
  mainnet funding step in OP-5 and needs none of its checklist. Put the key in the repo-ignored
  `.devnet/agon-f5.json` and set `DEVNET_KEYPAIR` in the CI secrets from the same file. It is a
  throwaway: it must never hold anything and must never be reused on mainnet.
- Funding alone does not make F5 runnable. OP-20 is the other half.
- Also, by hand, once F5 has run: case (g) of F5 is "removal done from Phantom, not only our CLI".
  Connect the devnet Swig wallet in Phantom, remove the Agon role from there, and confirm the next
  agent transaction fails. A script cannot assert that a person used a wallet, so this stays here.
- Done when: `spikes/F5/result.json` exists with all 7 cases and 0 unexpected successes, the
  Phantom removal in (g) is recorded with the signature that failed after it, and `agon revoke`
  has run end to end against 3 devnet wallets that really held Agon roles with the roles really
  gone afterwards, which is T-D03's Evidence line. That last clause arrived from a second OP-19
  filed by another session for the same wall; the two rows are merged here.
- Why it cannot wait: F5 is existential. If the cap does not hold on-chain, CP1 decides whether
  Agon ships read-only, and that decision needs the measurement rather than an opinion.

### * OP-23, Pick 2 real trader wallets, and verify 50 rows by hand
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-26, so F1 has a result before CP1 on 2026-09-27
- Unblocks: T-F01a, and through it T-F01b and the whole report
- What exactly: two things, both needing a person.
  1. **Pick 2 wallets with a real position history.** An automated heuristic keeps finding bots,
     routers and payout addresses: see `spikes/F1/README.md` for 3 that looked ideal and were not.
     The test is that the address owns the token balances that move AND opens and closes positions
     in non-quote assets. The team's own wallets qualify once OP-1 has produced history.
  2. **Hand-build the 50-row ledger per wallet.** Side, mint, and amount in base units, from the
     explorer, compared field by field against what the decoder said. The harness prints exactly
     those 50 rows, so this is verification and not construction: roughly an hour per wallet.
- Why a script cannot do it: Helius `SWAP` and our `swap` answer different questions. 22 of 50 on
  one wallet were SOL to USDC rotations, which Helius calls swaps and the decoder correctly does not,
  because no position opened or closed. Measured, in `spikes/F1/README.md`. A cross-check against
  the enhanced API would report a disagreement that is a definition, not an error.
- Done when: `spikes/F1/result.json` shows 50 of 50 classified correctly on each of 2 wallets,
  amounts exact to base units, with the coverage share recorded per wallet.

### * OP-1, Everyone trades from their test wallet, daily
- Status: open
- Owner: all, D coordinates
- Needed by: starts 2026-09-24, 20+ closed trades per wallet by CP2 (2026-10-02)
- Unblocks: T-F01b, T-F02, T-J01
- What exactly: each team member trades from their own test wallet every day until the wallet
  holds 20 or more closed trades, including a few deliberate exceptions to a stop rule so the
  miner has exceptions to find. Spread the trades across days, not one session.
- Done when: 5 wallets each show 20+ closed trades spanning 5 or more distinct days.
- **Escalated 2026-09-24, and this is now the critical path.** Beats 1 and 2 of the demo, the first
  50 seconds and the only part that is about the user's own history rather than about guardrails,
  cannot be filmed without this. It is the one blocker on the board that writing code cannot
  shorten. The arithmetic, from a board pass on 2026-09-24: submission closes 2026-10-11, 17 days
  out, CP2 is 8 days out. Starting 2026-09-25 and trading daily, 5 distinct days lands 2026-09-29
  at about 4 closed trades per wallet per day, which is comfortable. Every day nobody trades, the
  required trades per day rises and the span shortens, and past roughly 2026-10-06 the 5 distinct
  days cannot fit before submission at all. At that point beats 1 and 2 do not get cut for polish,
  they become unfilmable. This is the exact failure the PRD cites from monad, whose demo wallet had
  its whole history inside one 3-hour window.
- Why it cannot wait: only time produces history. Monad's demo wallet had its whole history in
  one 3-hour window, which broke its period filters (T8.8, T8.9).

### * OP-2, Helius plan and credit budget
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-25 for F1 and F2; before CP4 for the F8 index
- Unblocks: T-F01a, T-F01b, T-F02, T-A04, T-F08, T-F10
- What exactly: pick the Helius plan, get `HELIUS_API_KEY` for local dev (free tier is enough), a
  separate CI key used by nightly spikes only, and a paid plan for the hosted app. Write down the
  credit budget for a 2,000-transaction report, for the 5,000-wallet F8 ingest, and for F10
  webhooks. Also `HELIUS_WEBHOOK_SECRET` for F10.
- Measured 2026-09-24: a local dev key works against `mainnet.helius-rpc.com`. `getHealth` ok,
  `getSlot` 450004003, p50 389 ms over 10 calls from Mumbai. That is 1 of the 3 keys, and 0 of
  the 3 credit budgets, so this stays open.
- Done when: 3 separate keys exist, and the 3 credit budgets are written in `docs/plans/budget.md`
  with the cost per report calculated.

### * OP-3, Jupiter Portal API key
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-26
- Unblocks: T-F05b, T-F06a, T-C06
- What exactly: `JUPITER_API_KEY` from Jupiter Portal for higher rate limits on quotes and
  Trigger orders. The public quote and price API needs no key at low volume, so this is only for
  the 20-route spike and the benchmark runs.
- Measured 2026-09-24: a Portal key works against `api.jup.ag/swap/v1/quote`, served from
  `ap-southeast-1`. The limit is **10 requests per 10 seconds** (`x-ratelimit-current` plus
  `x-ratelimit-remaining` is 10, and `x-ratelimit-reset` minus `date` is 10 s). 20 quotes fired
  concurrently returned 10 x 200 and 10 x 429. The same 20 paced at 50/min returned 20 x 200 and
  0 x 429 in 23 s.
- **The done-when below cannot pass on this tier, and it is the criterion that is wrong, not the
  key.** A 20-request burst against a 10-per-10s bucket fails by arithmetic. Decide one of: raise
  the Jupiter tier, or reword the criterion to 20 quotes paced under 1/s with 0 x 429. This is not
  cosmetic: T-C06 budgets 1 quote per `check_trade`, so on this tier the guard tops out near 1
  check per second, and Benchmark A v2 (100 scenarios x 5 runs x 3 arms) is about 25 minutes of
  quote wall time on its own.
- Done when: the key is in the hosted env and a nightly-only CI secret, and a 20-quote burst does
  not rate-limit.

### * OP-4, Decide where Jev comes from, and confirm rate limits
- Status: open
- Owner: <unassigned>
- Needed by: CP1, 2026-09-27
- Unblocks: T-C05, T-F11a, T-F11b
- What exactly: pick exactly one of Cloudflare Workers AI (`typesafe/jev`), TypeSafe directly, or
  Venice, and confirm the rate limit supports 200-call latency runs at 1, 5 and 20 questions.
  Cloudflare needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` scoped to Workers AI
  only. The hosted app proxies `/jev` so users need no key of their own.
- Measured 2026-09-24 against `usejev.xyz/v1/systemone`, the TypeSafe-direct option: works, p50
  607 ms over 10 calls from Mumbai (round trip included, so T-C03 still has to measure the
  region). The question schema is `choice`, `score` or `noul`, each needing a `criteria` field;
  there is no boolean type. `choice` and `score` return per-option probabilities plus a
  `confidence`, and `output_tokens` is 0, so it scores rather than generates.
- **Caution for T-C05 and T-F11b:** on judgement questions it was near chance in a small probe.
  It called an obvious marketing blob concrete at p 0.90, and scored a deliberately speculative
  component 1.01 of 2 at confidence 0.056 against 1.81 at confidence 0.533 for a required one.
  The `confidence` field is the usable signal, which is what the below-threshold-goes-to-a-person
  rule already assumes. 3 calls is not a measurement, F11 is.
- Done when: one provider is named in `docs/plans/decisions.md`, the rate limit is written down,
  and a 200-call run completes without a 429.

### * OP-5, Fund the mainnet team test wallets
- Status: open
- Owner: <unassigned>
- Needed by: after T-D04 passes, before F6 on mainnet
- Unblocks: T-F06b, T-D04, T-J01
- What exactly: fund each mainnet team test wallet with $50 or less. The funding wallet must not
  be a team member's personal wallet. Keys live on team members' hardware or in password
  managers, never in CI, `.env`, chat or anything we host.
- Done when: 5 wallets funded with $50 or less each, the funding wallet address is recorded, and
  the pre-mainnet checklist box is ticked with a link.
- Hard rule: do not fund anything until T-D04 has all 8 boxes ticked and 2 sign-offs.

### * OP-6, Neon Postgres
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-29
- Unblocks: T-A04, T-E04, T-E09
- What exactly: `DATABASE_URL` for the report cache, beta metrics and the "is this rule right"
  answers. A Neon branch per PR, or none in CI. Local dev uses a local Postgres.
- Done when: the hosted app reads and writes one row, and a PR gets its own branch or CI skips
  the database tests cleanly.

### * OP-7, Create both GitHub repos and their tokens
- Updated 2026-09-25, later the same day: the public repo now exists. `manjeetsharma0796/agon`,
  public, default branch `main`, empty, and the invite is accepted. What is still wrong is that
  nothing points at it. `scripts/release.mjs` defaults `PUBLIC_REPO` to `agon-dev/agon`, which is a
  404, and `release.yml` passes `PUBLIC_REPO_TOKEN` but never sets `PUBLIC_REPO`. The repo also has
  0 Actions secrets configured, so `PUBLIC_REPO_TOKEN` is absent too. The release still fails on
  the first tag, at the push rather than at a check, for a different reason than before. 2 one-line
  changes close it, both needing workflow scope or repo settings, which is why they stay here
- Audited 2026-09-25, 2 of the 3 clauses verified and the third is a landmine. A claim push to
  `dev` succeeds: 17 claim PRs have merged. A code push straight to `dev` is rejected, tested just
  now with an empty commit, `GH013: Repository rule violations found for refs/heads/dev`. But the
  public repo does not exist: `scripts/release.mjs` defaults `PUBLIC_REPO` to `agon-dev/agon` and
  that is a 404, as is `manjeetsharma0796/agon`. The release job would fail on the first tag, and
  it would fail at the push rather than at a check, so the first anyone hears of it is a red
  release. Creating it, or setting `PUBLIC_REPO` to whatever it is really called, is the whole
  remainder of this row
- Status: open
- Owner: B
- Needed by: 2026-09-24
- Unblocks: T-B01, T-B02, T-J02
- What exactly: a private repo holding `dev` and all feature branches, and a separate public repo
  holding only `main`. Then `PUBLIC_REPO_TOKEN`, fine-grained with contents write on the public
  repo only, stored in the private repo's CI; and `NPM_TOKEN`, publish-only automation token,
  stored in the public repo's release job. Set branch protection on `dev` to allow direct pushes
  (the claim lock needs them) while requiring PR plus CI for anything that is not a `- Status:`
  line, which the `board` job enforces.
- Done when: a claim push to `dev` succeeds, a code push straight to `dev` is rejected by the
  `board` job, and a `release-*` tag reaches the public repo.

### * OP-8, Recruit the beta cohort
- Status: open
- Owner: E
- Needed by: 10 to 20 users by CP3 (2026-10-08); 50+ by CP6
- Unblocks: T-E09, T-J03
- What exactly: recruit active Solana traders from team networks, trader Discords, Telegram
  groups and X replies. World's Fair users get first refusal on the fall cohort. Read-only, so they
  sign nothing and we store no address beyond the session unless they opt in.
- Done when: 10+ reports have been run by people outside the team and each was asked "Is this
  rule right about you?".
- Why it cannot wait: recruiting is the slowest part of CP3, and CP3 has a 70% gate on it.

### * OP-9, Pin the LLM-guard baseline model
- Status: open
- Owner: B
- Needed by: CP2, 2026-10-02
- Unblocks: T-B04, T-B05, T-B07
- What exactly: name one chat model and version as the LLM-guard arm in benchmark B. It must
  be one agents actually use, or the comparison looks rigged. Get `LLM_BASELINE_API_KEY` for
  local dev and nightly CI only, never hosted. Separately, pin which agent runs benchmark A: an
  LLM through Solana Agent Kit, or Jupiter's Trading MCP. One, not both.
- Done when: the model id, its version and the benchmark agent are written in
  `benchmark/arms/README.md` and referenced by the published headline.

### * OP-10, Name the team leader
- Status: open
- Owner: <unassigned>
- Needed by: 2026-10-08
- Unblocks: T-J03, T-J04
- What exactly: prizes are paid only to the team leader (rules s.15). Pick one person and record
  it before submission.
- Done when: the name is in `docs/plans/submission-wf.md`.

### * OP-11, Get the beta terms reviewed
- Status: open
- Owner: <unassigned>
- Needed by: before any mainnet user, so after 2026-10-12
- Unblocks: T-D05
- What exactly: decide who reviews the beta terms before a user arms anything on mainnet. The
  terms must say plainly: experimental software, you can lose the capped amount, revoke from
  your wallet at any time. Beta users trading real funds through our code is a prize
  due-diligence question (rules s.13).
- Done when: a named reviewer has signed off and `docs/public/beta-terms.md` is published.

### * OP-12, Confirm the two-hackathon extension and the fall criteria
- Status: open
- Owner: <unassigned>
- Needed by: 2026-10-12
- Unblocks: T-J04
- What exactly: confirm with Colosseum that the same project may go to the World's Fair and
  then be extended for the fall hackathon (one team, one submission at a time, s.7; past winners
  Unruggable and Lomen carried one project across several Colosseum hackathons). In the same
  thread, ask whether the fall judging criteria match the World's Fair six. If traction or novelty is
  weighted differently, the fall priorities in `TASKS.md` change.
- Done when: a written answer exists, with the person and the channel recorded. The current
  Decisions-log entry is marked unverified until then.

### * OP-13, Decide the licence
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-26
- Unblocks: T-J02
- What exactly: MIT, or something else. Open source is a judged criterion and the PRD assumes
  an MIT repo with `check_trade` callable by any agent.
- Done when: `LICENSE` is committed and the README states it.

### OP-14, Search for a project that already does this
- Status: done 2026-09-25: searched, the claim holds and the wording is tightened in docs/plans/novelty.md. Nearest miss is SENTINEL, which derives from history and enforces on-chain but for an x402 agent's own runtime spending on Algorand, not a trader's swaps. Colosseum's own directory and Copilot need an account and were NOT searched, so the PRD's 2,992-entry figure is still unverified by a second pair of eyes
- Owner: <unassigned>
- Needed by: 2026-09-27
- Unblocks: the Novelty claim in the pitch, T-J01, T-J03
- What exactly: search the World's Fair project directory (public, 4,000+ builders) and the
  Frontier and Agent Hackathon winners for a wallet-analysis or agent-guardrail project. So far
  2,992 Breakout and Cypherpunk entries were searched via Colosseum Copilot, which is
  unverified and excludes Frontier, the February Agent Hackathon, the x402 hackathon and the
  current World's Fair.
- Done when: the count of directories searched and the nearest project found are written in
  `docs/plans/novelty.md`. If something matches, the novelty claim changes shape before it is
  pitched.

### OP-15, RugCheck token, optional
- Status: open
- Owner: <unassigned>
- Needed by: only if the public report endpoints rate-limit us
- Unblocks: nothing. RugCheck is enrichment and is never on the deciding path
- What exactly: `RUGCHECK_TOKEN`, only if the free endpoints start returning 429.
- Done when: either the key is in place, or this entry is dropped with "not needed, no rate limits
  hit" and a date.

### OP-16, Second person on Track E from CP2
- Status: open
- Owner: <unassigned>
- Needed by: CP2, 2026-10-02
- Unblocks: T-E04 through T-E09, T-J01
- What exactly: Track E is 6 jobs for 1 person (report page, share card, onboarding, beta
  recruiting, X, demo video). UX is a judged criterion and the demo video is how judges see
  everything else. The most plausible second person is whoever finishes Track D first.
- Done when: a second name is on Track E and at least 2 of the 6 jobs have moved to them in
  `TASKS.md`.

### * OP-17, Hosting project and the 3 environments
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-26, before T-E03 puts anything on staging
- Done, the agent-facing third: https://agon-dev.onrender.com/mcp is live, deployed from the
  Dockerfile on `dev`, 0 environment variables set. Verified end to end on 2026-09-25: health in
  0.68s, initialize returns the 2,052 character instructions, tools/list returns the stable 4,
  check_trade answers block with "12.4x your median size of 0.162 SOL, past your 2x limit" stamped
  check-trade/1+mint-check/1 at slot 450115322, arm_rule refuses through isError, get_report
  carries FIXTURE_NOTE, and an unrecorded wallet is refused rather than approved. It holds no key,
  because the image defaults to AGON_NET_MODE=replay, so there is nothing on it to rotate and
  nothing a caller can spend. The 2 remaining thirds of this row, the web app and the per
  environment keys, still need everything below.
- Ready for you: the MCP server is now a built and run image. `docker build -t agon-mcp .` then
  `docker run -p 8787:8787 agon-mcp` answers a real check_trade verdict with 0 keys set, because
  it defaults to AGON_NET_MODE=replay and ships no credential. Any host that builds a Dockerfile
  takes it as is. That is the agent-facing third of this row and it needs none of the keys the
  rest of the row is waiting on, so it can go up before OP-2, OP-3, OP-4 and OP-6 land
- Unblocks: T-B01 (its last acceptance clause), T-E03
- What exactly: create the hosting project and wire 3 environments, each with its own keys:
  preview on every PR push against devnet, staging on every merge to `dev` against devnet plus
  mainnet read-only, production on a release tag against mainnet. Needs the keys from OP-2
  (Helius), OP-3 (Jupiter), OP-4 (Jev) and OP-6 (Neon) to exist first, one set per environment,
  and `vercel.json` committed by whoever wires it. The scaffold deliberately does not ship a
  `vercel.json`: an unwired config file that no project reads is a green-looking thing with
  nothing behind it.
- Done when: 1 PR shows a preview URL, a merge to `dev` updates staging, and a `release-*` tag
  updates production, with 3 separate key sets and 0 shared between environments.

### * OP-18, Put the waitlist somewhere, and give it an inbox
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-24, the same day, because recruiting is the slowest part of CP3
- Unblocks: T-E02, and through it OP-8
- What exactly: the page is built and tested at `apps/web/app/waitlist/` and needs 2 things only a
  human can do. (1) Somewhere to receive a POST of `{email, address}` that returns 2xx and sends 1
  confirmation email; any form backend will do, and it must not wait on Neon (OP-6) or on the
  hosting project (OP-17), because both are slower than recruiting can afford. (2) A static deploy
  of that directory, then `ENDPOINT` in `index.html` set to the URL from (1). The form deliberately
  refuses to pretend while `ENDPOINT` is empty: it validates and then tells the visitor nothing was
  sent, because a waitlist that silently drops people is the one failure this task cannot recover
  from.
- Done when: a live URL takes an email and a Solana address with 0 login, 1 confirmation email
  arrives at an address someone on the team actually checked, and the URL is in T-E02's `Evidence:`
  line.

### * OP-20, CP1 decision: Jupiter is not on devnet, so F5 cases (a), (b) and (e) cannot run there
- Status: decided 2026-09-25 by Jishnu, option 1: run it on a Surfpool mainnet fork
- Decision: the fork carries the real Jupiter program and the real Swig program, costs 0, needs 0
  mainnet funds, and F9 already proved a committed snapshot replays offline with no key. Measured:
  the F9 snapshot is 281 KB for 295 accounts and the whole spike folder is 309 KB, so this is a
  laptop and a file in git, not a machine anyone provisions. Unmeasured and worth checking before
  anyone plans around it: F5 executes a swap, so its snapshot also pulls Jupiter's program account,
  its lookup tables and pool accounts, and will be larger than 281 KB. How much larger is not known
- Measured 2026-09-25, and the answer was not a size, it was a defect: `surfnet_exportSnapshot`
  **does not export programs at all**. Touching Jupiter and Swig on a live fork leaves the export
  at 294 accounts and 278 KB, unchanged, and neither program id appears in it. The only 2 scopes
  the method accepts are `network` and `preTransaction`; `network` is what F9 uses and it emits
  data accounts only. So the F9 pattern, commit a snapshot and replay it `--offline` with no key,
  does not extend to F5 by itself, because the programs F5 has to execute would be missing.
  It does extend with one step. The snapshot *format* carries `executable`, and `--snapshot` can be
  given more than once, so the 4 program accounts can be written into a second file by hand from a
  live fork read. Verified end to end: `surfpool start --offline --snapshot spikes/F9/snapshot.json
  --snapshot programs.json`, with HELIUS_API_KEY unset, serves Jupiter and Swig at their real
  mainnet ids with `executable: true` and owner BPFLoaderUpgradeable. **So F5 can be offline and
  reproducible on a fork, and it keeps F9's no-key property.**
  The size, finally: 4,114 KB for the 4 accounts, which is Jupiter's program data at 3,766 KB and
  Swig's at 347 KB, on top of F9's 278 KB. Whether that 4 MB is committed the way F9's 281 KB was,
  which is what buys the no-key replay, is a call for whoever picks up T-F05a
- Scope of the decision: the fork is for the demo and for proving F5 and F6. It is NOT the path new
  users are put on, because a fork needs each user pointed at a custom RPC, which is the same
  instruction every wallet drainer gives, and because one shared fork means one user's swap moves
  the pool state another user is quoted against
- The sharp reason, which is not the obvious one: a fork cannot move real funds, because its
  transactions execute on its own ledger and nothing is broadcast. But the signature is real. A
  Solana transaction is valid for about 150 slots, roughly a minute, after the blockhash it was
  signed with, and which blockhash the fork hands out decides everything. A fork that is not
  `--offline` proxies `getLatestBlockhash` to real mainnet and hands out a fresh genuine one, so a
  transaction signed against it is a valid mainnet transaction for the next minute and the fork
  operator is holding it. A shared live fork plus real user wallets means collecting signed
  submittable mainnet transactions from people who trusted you, which is structurally a drainer
  whether or not anyone intends it.
  F9 is safe by construction and this is why `--offline` is not a convenience: it runs from a
  snapshot pinned at slot 450049160, from 2026-09-24, and that snapshot carries the real
  `SysvarRecentB1ockHashes` account, checked. Those blockhashes expired months of slots ago, so
  nothing signed against it executes anywhere. **If a user-facing sandbox is ever wanted, the rule
  is that the fork is offline from a pinned snapshot and never live-proxied.**
- Owner: <unassigned>
- Needed by: 2026-09-27, CP1, because F5 is the gate on the arming UI
- Unblocks: T-F05a, and through it T-E06, the arming UI, and the live-arming demo beat
- What exactly: the pinned Jupiter id `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` is not a
  program on devnet. It is a plain wallet there: `executable: false`, owned by the system program,
  0 bytes, holding 4.51 SOL. On mainnet the same id is `executable: true`, owned by the BPF
  upgradeable loader, 36 bytes. Measured by `spikes/F5/run.mjs`, in `result.json` under
  `devnet.jupiterProgram`. Cases (c), (d) and (f) do not care, because Swig rejects those before
  any inner instruction runs. Cases (b) and (e) do: Swig applies a `tokenRecurringLimit` by
  comparing the Swig account's token balances after the inner instructions run, so with no program
  at that id the transaction fails before the limit is consulted. The run would record a rejection
  and it would be the wrong rejection, with the cap reading as holding when it was never asked.
  Pick 1 of 4: (1) run the whole thing on a **Surfpool mainnet fork**, which carries the real
  Jupiter program and the real Swig program, costs 0 and needs 0 mainnet funds, and whose tooling is
  already in the repo because F9 proved a committed Surfpool snapshot replays offline with no key;
  (2) run (b) and (e) on devnet against a program that is deployed there and moves the capped mint,
  and say in the result that the Jupiter leg was substituted; (3) move the cap cases to mainnet
  simulation, which is already T-F05c, and let T-F05a cover (c), (d), (f) and (a) as authorisation
  only; (4) deploy a Jupiter build to devnet, which nobody on this team controls.
- Done when: the decision is in the PRD Decisions log and T-F05a's `Acceptance:` line says which
  of the 7 cases run on devnet and which moved to T-F05c.
- Why it cannot wait: the World's Fair demo beat is live arming on devnet, decided on 2026-09-24.
  (c), (d) and (f) can be filmed on devnet once OP-19 lands. "The cap stopped an over-cap swap"
  cannot be filmed on devnet at all, whatever the funding, because there is no swap to stop there.
  So the most distinctive beat of the demo depends on this decision, and option 1 is the one that
  keeps it.


### OP-21, Decide the shape of the World's Fair demo: read-only or live arming
- Note 2026-09-25, from the OP-20 fork decision: a fork answers "where does the demo run", not
  "where do new users try it". Those are different questions and the fork only answers the first.
  For users, the read-only path needs no fork, no signing, no custom RPC and no keypair: it is what
  `check_trade` already does on a real mainnet wallet today. That is the only path that can be
  opened to people before F5 and F6 pass, and it is available now
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-27, CP1, because it changes what Track E builds next
- Unblocks: T-E06, T-E07, T-J01, and the shape of `docs/demo-script.md`
- What exactly: the demo script currently assumes beat 4 arms a rule for real and beat 6 revokes it
  from the wallet. Both need on-chain signing, which is gated behind F5, F6 and the T-D04
  pre-mainnet checklist, and the PRD separately bars any arming UI until F5 and F6 pass. F5 has not
  run, F6 has no spike directory, and the read-only beta is defined as signing nothing. So the
  World's Fair cut is one of: (a) read-only, beats 1, 2, 3 and 7, with arming shown in simulation
  and labelled as simulation; (b) live arming on a Surfpool mainnet fork, NOT devnet,
  for the reason measured in OP-20: the pinned Jupiter id is not a program on devnet, so the cap
  cases cannot run there at any funding level; (c) live arming on mainnet, which needs F5, F6, all 8
  T-D04 boxes and 2 sign-offs, and OP-5 funds. Decide which, because Track E builds a different
  screen for each and the demo script has to say the true thing on camera.
- Done when: one option is written in the PRD Decisions log, `docs/demo-script.md` beat 4 and beat 6
  match it, and T-E06 and T-E07 either have a target or are cut with a date and a reason.

### OP-22, Film a thin working slice before building more
- Retitled 2026-09-25: it said "on devnet", which OP-20 overruled. Devnet cannot run the arming
  half at all, because the pinned Jupiter id is not a program there
- Status: open
- Owner: <unassigned>
- Needed by: 2026-09-27, CP1
- Unblocks: nothing on paper, and the confidence of everyone reading the board
- What exactly: about 9,000 lines have merged and no single path runs end to end yet. Every piece is
  tested in isolation and nothing has been seen working together, which is how a repo arrives at a
  demo week with 11 green components and no demo. Pick the shortest path that touches every layer
  once, on devnet, with no UI: read a real wallet, decode its swaps, mine one rule, ask check_trade
  about one trade, and have it refuse with a reason. Whatever it takes to make that run is the
  priority, and whatever it does not touch is not.
- Status note 2026-09-25: the read-only half is done and pasted below. `agon check` runs every
  layer once in 1 command: read a real mainnet wallet, decode its swaps from balance changes, build
  the FIFO ledger, mine the rules, read the mint's authorities off the chain, and refuse a trade
  with the numbers behind the refusal. Exit code 1, because a script must not read a refusal as
  permission.

  ```
  Wallet HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC
  Mined from 16 closed trades: stop none, size 161695414, hold 1
  Proposed: buy 2000000000 base units of EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

  Verdict: block
    size-vs-median: 12.4x your median size of 0.162 SOL, past your 2x limit. Stopped. Send
      0.323 SOL or less, or raise the limit. (12.4 against 2 x-median)
    quote-missing: No quote was taken for this trade, so what the fill costs and how far it
      moves the price are both unknown. Not safe to proceed. Quote the route and check again.
    text-not-screened: This token's name and description were not screened, so an instruction
      hidden in them would have reached your agent unread. Not safe to proceed.
    mint-freeze-authority: Freeze authority is live on this token, held by
      7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar. That key can freeze your balance in place at
      any time, including while you are trying to sell.
    mint-authority-live: The supply of this token can still be increased by
      BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG.

  Stamped check-trade/1+mint-check/1 at slot 450115322.
  ```

  What this does not prove, stated rather than left to be assumed. Nothing was signed and nothing
  was armed: this is the guard refusing, not a Swig cap rejecting a transaction on chain, which is
  still F5 and still OP-20. The quote and the injection screen were both skipped, which is why 2 of
  the 5 reasons are "not read" rather than a finding, and it is why this command can never print
  `pass`. The mint reasons are the F3 result showing up in the product: USDC has a live freeze
  authority, so the guard blocks it, and that is the existential question CP1 has to answer. The
  numbers moved between 2 runs an hour apart, 28 closed trades to 16, because the wallet kept
  trading; the recording is stamped so a rerun is comparable.
- Done when: the arming half also runs, 1 command producing 1 on-chain rejection against a real
  mainnet-fork wallet, with the output pasted here. Read OP-20 before reaching for devnet.

### OP-24, Reconcile CLAUDE.md's "3 questions" rule with T-B08's review-escalation questions
- Status: open
- Owner: <unassigned>
- Needed by: CP2, 2026-10-02, alongside the T-B08 keep or cut decision
- Unblocks: T-B08 (documentation only, not the code)
- What exactly: CLAUDE.md's Non-negotiable section reads "Jev answers only 3 non-numeric
  questions: token category, impersonation, injection screen", unqualified. `scripts/jev-review.mjs`
  (T-B08 use 1) asks Jev 4 different `choice` questions (money math, transaction building, a
  frozen contract, cross-track docs) about a PR diff, never about a trade. TASKS.md's own T-B08 row
  describes exactly this design and was merged with it, so the row and CLAUDE.md's wording disagree
  on paper even though neither touches the trading path: T-B08's questions never reach check_trade,
  never carry a number, and its own kill criterion repeats the same "never numeric, never the rule
  itself" constraint in different words. An agent should not silently decide whether the "3
  questions" line is scoped to the trading guard or to every use of Jev anywhere in the repo; a
  person should either reword CLAUDE.md to say "the trading guard asks Jev only 3 questions" or say
  T-B08 does not get an exception.
- Done when: CLAUDE.md's wording and TASKS.md's T-B08 row agree, in either direction.

### OP-25, Two frozen contracts cannot say "refused" or "not applicable"
- Status: open
- Owner: <unassigned>
- Needed by: CP2, 2026-10-02
- Unblocks: T-C07's remaining review findings, and any client that has to act on a verdict
- What exactly: an outside agent tested the deployed MCP server and raised 4 findings. 1 was a
  marker gap and is fixed. The other 3 all landed on the same thing, which is more useful than any
  of them alone: **the frozen contracts have no way to express a refusal or a check that did not
  run.** Two changes, both needing the owners of both sides plus fixtures in the same commit.

  1. **`Reason` has no tag.** `packages/core/src/check-trade.ts`, `Reason` is
     `{rule, message, observed?, limit?, unit?}`. `quote-missing` and `text-not-screened` fire on
     every single call regardless of the trade, so the reasons that actually depend on the trade
     are buried among ones that never vary. Severity already exists inside the guard
     (`packages/guard/src/check-trade.ts`, sorted block then unsure then note) and is mapped away
     at the boundary before `CheckTradeOutput.parse`, so the information is computed and then
     discarded. A client cannot tell which reason caused the verdict. Adding a tag or carrying
     severity through is the smaller half of this row and the higher leverage: it makes every
     other output legible before anything else is built on top.

  2. **`ArmedRule` can only describe a rule that exists.** `packages/core/src/rule.ts`, it requires
     a non-empty `swigRole.roleId`. So `arm_rule` cannot return a refusal in its success shape
     without inventing an on-chain claim, which is the one thing that path refuses to do, and the
     refusal goes out as `isError: true` instead. That is correct today and it is why naive clients
     log a policy denial as a failure. Contrast `check_trade`, which returns `block` with
     `isError: false` because its contract has a `Verdict` field that can say no. The fix is a
     union, roughly `{armed: ArmedRule} | {refused: {code, spec, message}}`, so a refusal is
     expressible without claiming anything exists.

  Budget note, because this row has a gate of its own: `check_trade` is measured at 319 tokens of
  400 with the fixture marker attached, and T-C13 is already tracking an 8-reason verdict at 452.
  A new field on every reason needs a measured answer or it fails that gate.
- Done when: both sides have agreed each change, the examples under `fixtures/contracts/` change in
  the same commit, and the `check_trade` token budget is re-measured and still passes.
- Why it cannot wait: it is cheap now and expensive later. Every client written against the
  current shape has to change when these do, and the first outside agent to use the server hit
  both inside an hour.

### OP-26, Decided: execution mode is the user's choice, and the stack does not fork
- Status: decided 2026-09-25 by Jishnu, recorded here because the PRD Decisions log is outside
  this repo and Track C, D and E all build against it
- Owner: <unassigned>, for copying into the PRD Decisions log
- Needed by: now, it is already shaping T-C08, T-D06 and Track E
- Unblocks: T-D06, and stops anyone building a second execution stack
- What exactly: the question was whether Agon executes trades for the user or only advises them.
  The answer is both, chosen per user. They can let the agent trade inside the cap, or keep the
  key and trade themselves with the guard advising.

  **The engineering consequence is the part worth writing down: the mode does not fork the
  product.** Every mode runs the same `check_trade` over the same mined rules and the same mint
  check. What changes is only who signs and when:

  | mode | who signs | needs the agent key, Swig role, daemon, F5, F6, T-D04 |
  | --- | --- | --- |
  | agent trades, unattended | agent, under its capped role | yes, all of it |
  | user reviews then signs | the user, from their own wallet | no |
  | alerts only, user trades elsewhere | the user, outside Agon | no |

  So there must be one guard, one rule miner and one verdict shape, with the signer swapped at the
  edge. Two parallel execution stacks is the failure this row exists to prevent.

  Two consequences nobody has costed yet. First, the user-signs path needs none of the on-chain
  gates, so it is buildable today while F5 is failing, and it is the only path that is. Second,
  the user-signs path does not exercise the capped revocable role, which is the novel claim, so
  shipping only that path leaves Agon a trade screener. Both paths are wanted; the order they are
  built in is a Track E call.
- Done when: this is copied into the PRD Decisions log and Track E's screens name which mode they
  are for.

### OP-27, arm_rule lets the agent choose its own spending limit
- Status: open
- Owner: <unassigned>
- Needed by: before any arming UI is designed, so before T-E06
- Unblocks: T-E06, T-C08, and the honesty of the core claim
- What exactly: the product's claim is a spending limit the agent has to trade inside. The contract
  that grants that limit currently lets the agent set it. `arm_rule` is an MCP tool an agent calls,
  and its input is `RuleSpec`, whose 4 fields are `mints`, `cap`, `triggerType` and `expiresAt`.
  So the agent names its own cap. Worse, and easier to check: **`RuleSpec` has no wallet field at
  all**, so `arm_rule` cannot say whose account it is arming, while `list_rules` and `get_report`
  both take a `WalletQuery`. And there is no signature, approval or user field anywhere on the
  path, so nothing ties a cap to the person whose money it caps. `ArmedRule`'s own comment says
  "what exists on-chain once the user's wallet has signed", and no part of the contract requires
  that signature or records it.
  None of this can bite today, because `armRule` refuses every call, which is why it has gone
  unnoticed through 4 reviews. It bites the moment arming is built, and it is a frozen contract, so
  it is cheaper to settle now than after 2 surfaces read it.
  What the shape probably needs: the wallet the rule is for, and evidence that its owner approved
  this cap rather than the caller proposing it. Whether that evidence is a signature over the spec,
  a one-time approval reference, or arming simply not being an agent-callable tool at all, is the
  decision. The 3rd option is worth taking seriously: a cap the agent cannot request is a stronger
  claim than a cap it requests and is refused.
- Done when: the owners of both sides agree the shape, `fixtures/contracts/` changes in the same
  commit, and T-E06's screen is designed against whichever answer wins.
- Why it cannot wait: it is the difference between the pitch and the opposite of the pitch, and
  every client written against today's shape has to change when it does.
