# Agon PRD

**This is the central PRD and it is kept current.** It replaces
`Agon PRD hackathon build with feasibility gates.pdf`, which was exported 2026-09-23, committed
once in `45dc8ab` and never updated. That PDF is removed rather than kept beside this file,
because two PRDs means nobody knows which one is true; it remains in git history at that commit if
anyone needs the original wording.

Agon turns a trader's own on-chain history into a spending limit their AI agent must trade inside,
enforced on Solana. It answers one question: "You set a stop. Why don't you keep it?"

**Rule for this document:** every risky claim has a feasibility spike with a measured pass
threshold. Anything without a number is a guess and is labelled as one.

**What lives elsewhere, and is not repeated here.** This file is the product. The machinery has
better homes and duplicating it is how the two drift apart.

| | Where |
|---|---|
| Decisions taken since 2026-09-23 | `DECISIONS.md` |
| Feasibility status, measured | `FEASIBILITY.md`, generated from `spikes/*/result.json` |
| Each test's threshold, written before it ran | `spikes/F*/thresholds.json` |
| Tasks, the claim protocol, the tool table | `TASKS.md` sections 1 to 4 |
| Non-negotiables, layout, how we work | `CLAUDE.md` |
| Keys, funding, anything needing a human | `OPERATOR_TODO.md` |
| The 11 failure messages, implemented | `packages/core/src/messages.ts` |

## Summary

**Targets.** Crypto World's Fair, submissions close 2026-10-12 23:59 PT. Then Colosseum's fall
Solana hackathon, 2026-09-28 to 2026-11-02, with the extended build.

**Custody: non-custodial, with one qualification that has to be said out loud.** The user's key
never leaves their wallet. The agent holds a capped, revocable Swig role and never
`manageAuthority`. 24/7 rules run as Jupiter Trigger orders, not on our servers.

The qualification: the Swig vault is **a separate address from the user's wallet**, so funding it
is a real transfer, and the blast radius is whatever was moved in. And funds resting inside an open
Jupiter Trigger order sit in Jupiter's own vault, which is not the Swig custody story. A revoke
does not return them. See OP-29 and `packages/core/src/messages.ts`'s `revokedWithOpenOrder`.

**Execution mode is the user's choice, and the stack does not fork** (OP-26). Three modes: the
agent trades unattended under its capped role; the user reviews and signs each trade; or alerts
only, and the user trades elsewhere.

**The cap means "up to 2x its number in a short burst", and the product says so** (OP-32). Swig's
windows align to the global slot clock, so an agent can spend its whole allowance at the end of one
window and again at the start of the next. Measured: 0.9 wSOL in 37 slots against a 0.5 per 150
cap. We arm exactly the number the user typed and print the rolling worst case beside it.

**Team:** 5 full-stack engineers working with coding agents.

## Judging criteria

Beta testers, public X posts and published benchmarks are allowed and feed three of the six judged
criteria. Nothing in the World's Fair rules restricts marketing, social posts or real users
(official rules, section 8). The fall hackathon's criteria are assumed to be the same six until
confirmed.

| Criterion | What judges ask | What Agon shows |
|---|---|---|
| Functionality | How well does it work, what is the code quality | Feasibility results, public repo, live demo |
| Potential impact | Addressable market, impact on the ecosystem | Beta cohort numbers, the guardrail benchmark |
| Novelty | How unique is the concept | The join, not either half. See below |
| UX | Does it use the chain to make UX better | Revoke without us; the chain as the verifier of every run |
| Open source | Is it open source, does it compose | MIT repo (OP-13); `check_trade` callable by any agent |
| Business plan | Viable business, can the team execute | Pricing slide, beta retention, weekly shipped updates |

**The novelty claim, and what has actually been checked.** Wallet analysis exists (Nansen, Solana
Tracker, BingX). On-chain agent spend caps exist (Swig, Coinbase and MetaMask agentic wallets).
What we have not found is a product that **derives the cap from the user's own history and enforces
that number on-chain**.

Verified 2026-09-26 against Colosseum Copilot: Breakout 1,416 projects plus Cypherpunk 1,576 is
exactly the 2,992 the earlier draft cited, so the denominator is right. The nearest neighbour found
is **`mushin`** (Cypherpunk, Sep 2025), which prevents revenge trading through enforced cooldowns.
Name it rather than omit it: it differs on all three axes the claim rests on, because it constrains
the human not an agent, enforces in a browser extension not on chain, and its rule is a fixed
cooldown rather than a number mined from that person's swaps.

Still unsearched: the current World's Fair directory, Frontier, the February Agent Hackathon and
the x402 hackathon. The corpus above ends at Cypherpunk.

**Prizes** (rules s.14): Grand Champion $30,000; 20 standout teams $15,000 each; Solana track
$100,000 across 10 products. Winners announced around 2026-12-05.

**Constraints.** One team, one submission at a time (s.7); extending the same project into the fall
is confirmed individually with Superteam but the source is not yet recorded. Prize receipt depends
on due diligence (s.13), which is part of why the pre-mainnet checklist exists.

## Scope

World's Fair ships the loop end to end on one wallet: mine, check, arm, revoke. The fall build adds
the screener, event triggers and the decision model. Every item names the feasibility test it
depends on.

| Feature | World's Fair (Oct 12) | Fall (Nov 2) | Depends on |
|---|---|---|---|
| Wallet report: stop discipline, sizing, hold time, cost of exceptions | Yes | Yes | F1, F2 |
| `check_trade` MCP tool: token risk plus "breaks your own rule" | Yes | Yes | F3, F4 |
| Jev judgement: token category, impersonation, injection screen. Everything numeric, style fit included, is arithmetic | Yes | Yes | F11 |
| Arm a rule: Swig role (`program = Jupiter`, `tokenRecurringLimit`) plus Jupiter Trigger order | Yes | Yes | F5, F6, F7 |
| Revoke from wallet, live | Yes | Yes | F5 |
| Shareable "what your exceptions cost" card | Yes | Yes | F2 |
| Guardrail benchmark, published | v1, 20 scenarios | v2, full suite | F9 |
| Speed benchmark: Jev vs LLM guard vs arithmetic | v1, 3 arms, latency and accuracy | Full 4-arm harness plus Kev-0.5B | F11, F9 |
| Beta cohort | 10 to 20, read-only | 50+, armed rules | Pre-mainnet checklist |
| Behavioural screener over a seeded index | No | Yes | F8 |
| Balance- and event-triggered rules via Helius | No | Yes | F10 |
| Pricing and paid tier | Slide only | Slide plus waitlist | None |

**Where everything runs, decided 2026-09-27 (OP-21):** live arming on a Surfpool mainnet fork, for
the demo and for testers both, until every mainnet gate passes. Arming on the fork is measured end
to end with a real Phantom, so the demo needs no simulation caveat. Phantom reaches a fork through
Developer Settings, Solana Localnet, and in that mode Phantom's own balance and activity screens
read "not supported", so our screens have to carry the balances.

**Cut, and why.** Record-and-replay of arbitrary agent tasks: Jupiter's CLI and hosted Trading MCP
already make the first run cheap. Our own stop-loss executor: Jupiter Trigger V2 already runs stops
from vaults around the clock, so we create Trigger orders and do not race them. DuckDB, Yellowstone
streaming and speculative transaction builds: latency work only pays when racing for a slot.
Hosting a signing daemon for users: that makes us a holder of spend authority.

## Components

One TypeScript monorepo, four deployable pieces, no custom Solana program. **Anything that can sign
runs on the user's machine; anything hosted only reads.** The user's wallet signs everything that
grants or removes authority; the daemon's key can only spend inside the Swig role.

| Component | Where it runs | What it does |
|---|---|---|
| `agon` CLI | User machine (npm) | Install, register MCP with the user's assistants, start the daemon |
| MCP server | User machine, stdio | `get_report`, `check_trade`, `arm_rule`, `list_rules`. One stable tool list so prompt caches survive |
| Local daemon | User machine | Holds the agent key in the OS keychain, builds and signs swaps inside the Swig role, event triggers in the fall |
| Guard (`check_trade`) | Library, used by MCP and API | Token check, personal-rule check (arithmetic), Jev judgement, price band vs a Jupiter quote |
| Decoder and miner | Library, used by API | Balance-change decoding, FIFO P&L, rule mining, report JSON |
| Agon API | Hosted | `/report/:address`, `/check`, Jev proxy so users need no Jev key, token-check cache, beta metrics |
| Web app | Hosted | Paste an address, report, share card, arm and fund a vault, revoke, benchmark page |
| On-chain | Solana | Swig smart wallet and role, Jupiter Trigger V2 orders. No program of our own |
| Benchmark harness | CI and laptops | Benchmarks A and B on a pinned mainnet fork |

Repo layout is in `CLAUDE.md`.

### How the guard produces decision speed

1. **Arithmetic first.** Every numeric check (size, stop distance, price band, slippage, style fit)
   is arithmetic. If all guards resolve arithmetically, no model is called at all, and this should
   be the common path.
2. **One batched Jev call.** Jev evaluates all questions in a single pass and output tokens are
   free, so twenty questions cost what one costs. F11 (b) tests that claim.
3. **Cache what never changes.** A token's category is decided once and cached for all users, so
   the share of model-free checks grows as usage grows.
4. **Pre-warm and fan out.** Profile and mint data load at arm time, not per trigger. Account
   reads, the quote and the transaction build run in parallel.

**Acceptance:** the share of `check_trade` calls resolved without any model call is measured and
reported in Benchmark B.

### Guardrails, in layers

Each layer assumes the one above it failed.

1. **Guard verdict.** `check_trade` must pass.
2. **Check bound to the exact transaction.** The daemon signs only a transaction whose message hash
   matches a `check_trade` approval from the last 30 seconds. A different amount or route needs a
   new check.
3. **Injection stance.** All outside text is data: token names and descriptions, social links,
   webhook payloads, tool outputs. Every such string goes through Jev's injection screen in the
   same batched call, and a "looks injected" flag blocks. Nothing fetched can change a rule.
4. **On-chain cap.** The Swig role allows only Jupiter's program and only up to
   `tokenRecurringLimit`. This holds even if layers 1 to 3 and the whole machine are compromised.
5. **Hand-back.** Any unsure or failed verdict returns to the user with the reason and the numbers.
   Nothing retries silently.
6. **Kill switch.** One wallet signature removes every Agon role.

## Failure behaviour

**Anything that can move funds fails closed:** if we cannot verify, the trade does not go out.
Analytics fail open but always say what they are based on. Every failure message names the cause,
the number involved and what the user can do next. No blank fields, no "N/A", no "something went
wrong".

All eleven rows are implemented in `packages/core/src/messages.ts`, each with its `mode`
(`closed` or `open`) and a `systemDoes` line, and a test asserts none contains a blank field.

| Failure | What the user sees | Never |
|---|---|---|
| Helius rate-limits or drops mid-history | Read 1,240 of about 2,000 transactions, up to Jun 3, Helius returned 429 | Show a report as if history were complete |
| A transaction we cannot decode | Excluded 37 transactions from 2 programs we do not read yet, with ids | Guess, or drop silently |
| Too little history for a rule | 12 closed trades; a stop rule needs 20 | Invent a rule from 3 trades |
| RugCheck slow or unavailable | RugCheck did not answer in time; on-chain checks passed | Treat a timeout as a pass without saying so |
| Our own mint check cannot reach RPC | Could not verify this token, not safe to proceed | Let the trade out unverified |
| Price moves past the band between check and submit | Quote moved 2.3% since the check, beyond your 1% band | Submit on the stale check |
| Swig rejects: over cap | This needs 3.2 SOL; 1.1 left in this window, resets in about 4h 10m | Retry automatically with a smaller amount |
| Transaction may not have landed | Checking whether it landed, then the signature and its final status | Send twice |
| Trigger order not filled yet | Jupiter's order status, the trigger price against the current price | Say "executed" before it is |
| Daemon was offline | Offline 3h 12m; Jupiter orders were unaffected; 2 event rules did not run | Fire missed triggers late at today's prices |
| User revokes while funds sit in a Trigger order | Rule revoked; 2.0 SOL is still inside an open Jupiter order; cancel it? | Imply the revoke returned those funds |

**Two rows this catalogue still needs**, both found on the fork on 2026-09-26. Swig reports a cap
refusal as `insufficient funds for instruction`, where nothing says "limit", so it has to be
translated. And when a trade fails, **the innermost failing program decides who refused**: a
Jupiter slippage error must never be reported as the cap.

## Pre-mainnet checklist

Every box ticked, with a link to evidence, before any mainnet transaction. Two team members sign
off and neither wrote the code under test.

**Before team wallets touch mainnet:**

- [ ] F5 passed all 7 cases on a mainnet fork. *Reworded 2026-09-25: the original said "on devnet
      and in mainnet simulation", and OP-20 measured that the pinned Jupiter id is not a program on
      devnet, so the cap cases cannot run there at any funding level.*
- [ ] F6 passed in mainnet simulation
- [ ] Program ids for Swig and Jupiter pinned in config and checked against their official docs, no
      id read from user input
- [ ] The agent key has no `manageAuthority`, verified by reading the role on-chain, not from our
      config
- [ ] Signature-status check before resubmit, tested with a deliberately dropped transaction
- [ ] Every mainnet test wallet funded with $50 or less, and the funding wallet is not a team
      member's personal wallet
- [ ] Kill switch tested: one command removes every Agon role from every test wallet
- [ ] Keys: agent keys live only in the local daemon's OS keychain, none in `.env`, logs or the
      repo, and the secret scan passes

**Before beta users arm rules on mainnet (fall only):** everything above, plus two weeks of
team-wallet mainnet use with no unexplained transaction; a per-user cap defaulting to $25 per
window with our code unable to set a higher cap than the user typed; beta terms stating plainly
that this is experimental software, that you can lose the capped amount, and that you can revoke
from your wallet at any time; a second engineer having reviewed every line that builds a
transaction or a Swig instruction; revocation tested from Phantom and Backpack by someone outside
the team; and an incident plan naming who runs the kill switch, how users are told, and within what
time.

**The read-only beta needs none of it.** It never signs anything. It needs only the secret scan,
and no storage of users' addresses beyond the session unless they opt in.

## Benchmarks to publish

Two benchmarks: how much damage guardrails prevent, and how fast and accurate the safety layer is.

**The honest speed claim is decision speed.** Our safety verdict is faster than the LLM-guard
verdict most agent frameworks use, at equal or better accuracy. **We do not claim faster
execution:** we route through Jupiter and add checks, so a guarded trade is at best at parity, and
we publish the measured overhead and call it parity. Decision speed improves with routing and
caching; execution speed does not, because the slot floor is shared.

**Benchmark A, agents with and without guardrails.** One LLM agent, model and version pinned,
trading through Jupiter on a mainnet fork pinned to one slot. 100 scenarios committed before the
first run: 40 normal trades inside the user's profile, 30 dangerous tokens, 30 rule breaks
including prompt injection. Three arms: agent alone; agent plus `check_trade`; agent plus
`check_trade` plus a Swig cap. The third arm is the point, because when injection tricks the agent
into skipping the check, the on-chain cap still holds. Metrics per arm: dangerous trades executed,
rule breaks executed, **normal trades wrongly blocked**, SOL at risk. At least 5 runs per scenario,
mean and range. World's Fair v1 is 20 scenarios and arms 1 and 2; fall v2 is all 100 and all three.

**Benchmark B, speed and accuracy of the safety layer.** Three arms on the same 100 labelled cases:
arithmetic only; arithmetic plus Jev; an LLM guard alone with a pinned model and structured output.
v1 measures p50 and p95 latency of the full `check_trade` call and correct verdicts on the 100
cases, cold and warm reported separately, plus the no-model share. Moved to fall: Brier calibration,
cost per 1,000 checks from invoices, end-to-end timing, on-chain overhead against a direct Jupiter
swap, a fourth arithmetic-plus-LLM arm, and a local Kev-0.5B arm.

**Headline format:** "Safety verdict in p95 X ms vs Y ms for an LLM guard, with Z% fewer wrong
verdicts." Every number comes from the published run.

**Publication rules.** Scenarios, metrics and pass criteria are committed to the public repo before
the first run and the commit hash goes in every post. **All runs are published, including the ones
where Agon does badly, because false blocks are a real cost.** One command reproduces the numbers
(F9). No named competitor comparisons unless their run is in the repo too.

| Say | Do not say |
|---|---|
| "Across 100 pre-registered scenarios, the agent executed 0 of 30 dangerous-token trades with Agon vs 11 without" | "Agents are 10x safer" |
| "Even when a prompt injection got past the agent, the Swig cap stopped 30 of 30" | "Unhackable" |
| "Safety check in p95 240 ms vs 3.1 s for an LLM guard, with fewer wrong verdicts" | Any speed claim without the LLM-guard baseline beside it |
| "Jev handles the judgement; every numeric check is plain arithmetic" | "AI decides your trades" |

Numbers in that table are format examples, not results.

## Beta testers and X

Beta users are also a feasibility test: they tell us whether the mined rules are true about real
people, which no spike can. Every report asks one question: **"Is this rule right about you?"**
(yes, no, partly).

**Gate at CP3:** "rule is right" at 70% or above across 10 or more reports. Below 70%, the report
ships as descriptive statistics, the rule-mining claim comes out of the pitch and the X posts, and
the miner is the problem to fix before the fall build, whatever F2 said.

| | World's Fair (to Oct 12) | Fall (to Nov 2) |
|---|---|---|
| Who | 10 to 20 active Solana traders | 50+, World's Fair users first |
| What they do | Paste an address, get the report, share the card | Arm one rule, capped at $25 per window |
| Signs anything | No, read-only | Yes, only after the checklist passes |
| We track | Reports run, "rule is right" rate, share rate, 7-day return | Plus rules armed, revokes, blocked trades, week-over-week retention |
| Gate | None | Every checklist box ticked |

One build-in-public post per week, mirrored as a Colosseum project update. Benchmark posts carry
the repo commit hash and the one-command rerun. User share cards are posted only by the user, or by
us with written consent.

**Never on X:** a named person's wallet, habits or P&L without their consent; "copy this wallet" or
anything reading as a recommendation, because Agon describes behaviour and never says what to buy;
a token, points or airdrop teaser, which adds legal and diligence risk for no judging benefit.

## Open questions

Decided ones have moved to `DECISIONS.md` and are not repeated here.

- **Do the fall hackathon judging criteria match the World's Fair six?** If they weight traction or
  novelty differently, the fall column's priorities change.
- **Who is the team leader?** Prizes are paid only to them (rules s.15). OP-10.
- **Which agent runs the benchmark:** an LLM through Solana Agent Kit, or Jupiter's Trading MCP?
- **Which chat model is the LLM-guard baseline in Benchmark B?** It has to be one agents actually
  use, or the comparison looks rigged. OP-9.
- **Jev access:** Cloudflare Workers AI, TypeSafe directly, or Venice? Confirm rate limits for
  200-call latency runs. OP-4.
- **Beta terms:** who reviews them before any user signs on mainnet? OP-11.
- **Search the current World's Fair directory**, and Frontier and the Agent Hackathon winners, for
  a wallet-analysis or agent-guardrail project. Colosseum Copilot answered the Breakout and
  Cypherpunk half on 2026-09-26; those four are still unsearched.
- **Does the Jupiter-only role gate every call, or only calls that move value?** A memo instruction
  is authorised today. Whether every no-value instruction is harmless is a measurement nobody has
  taken. OP-28.
- **Can Swig cap a second program at all?** If it can, the agent managing its own Trigger orders
  inside a cap becomes the better product and OP-29 is revisited.
- **Two claims the failure catalogue does not make yet**, both raised by the 2026-09-25 market
  review and neither adopted: that a spending cap is not a loss cap, and that a mined habit is
  described rather than endorsed. Both belong in Failure behaviour above if they are accepted.

Swig's role expiry, which used to be an open question deciding F7, is answered: the protocol-level
SDK has a native expiry and it holds on-chain, measured in F7 clause 1.

## Sources

Crypto World's Fair official rules (judging s.8, limits s.7, winners s.13, prizes s.14) and the
event page. Colosseum 2026 hackathon dates and Copilot project records. The Swig permissions
reference. The Jupiter developer changelog and CLI. Agon, product and technical reference.
