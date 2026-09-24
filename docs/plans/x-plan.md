# Build in public, weekly

One post a week, mirrored as a Colosseum project update. Past winners (Seer, Daiko, Lomen) posted
3 to 4 updates, so **3 is the floor, not the target**, and they have to land before the World's
Fair submission closes on 2026-10-11.

Posts are generated from the Friday dashboard and the `engineering:standup` output, so a week with
nothing measured produces nothing to post, which is the correct outcome rather than a gap to fill
with adjectives.

## The schedule

Day 1 is 2026-09-24, a Thursday, so the cadence is every Friday alongside the existing Friday pass
(`/ponytail-audit`, `/ponytail-debt`, `engineering:standup`).

| # | Date | Lands near | Likely subject, if the number exists by then |
|---|---|---|---|
| 1 | 2026-09-25 | day 2 | What Agon is, and the feasibility-gate method: every risky claim has a spike with a threshold written before the run |
| 2 | 2026-10-02 | CP2 | The first F1 and F2 numbers, decoder coverage and what the miner found |
| 3 | 2026-10-09 | before submission | Benchmark A v1: 20 scenarios, arms 1 and 2, with the commit hash |
| 4 | 2026-10-16 | CP4 | Benchmark B v1: verdict latency beside verdict accuracy |
| 5 | 2026-10-23 | CP5 | Arming and revoking on mainnet, if and only if the pre-mainnet checklist passed |
| 6 | 2026-10-30 | CP6 | Beta cohort numbers and the "is this rule right" rate |

Posts 1 to 3 satisfy the floor. If a subject has no measured number by its Friday, the post covers
what was learned instead, including a failed spike. A failed spike is a better post than a vague
one, and the repo publishes those anyway.

## Say, and do not say

Copied from the PRD, and these are not stylistic preferences.

| Say | Do not say |
|---|---|
| "Across 100 pre-registered scenarios, the agent executed 0 of 30 dangerous-token trades with Agon vs 11 without." | The same sentence without the LLM-guard baseline beside it |
| "Safety verdict in p95 X ms vs Y ms for an LLM guard, with Z% fewer wrong verdicts." | Any latency number without the accuracy number in the same sentence |
| "Jev handles the judgement; every numeric check is plain arithmetic." | "AI decides your trades" |

The numbers above are formats, not results. Every figure in a real post comes from a published run.

**Never claim faster execution.** We route through Jupiter and add checks, so a guarded trade is at
best at parity with an unguarded one. The claim is decision speed, and the roadmap must not imply
otherwise: decision speed improves with routing and caching, execution speed does not, because the
slot floor is shared.

## Never on X

1. **A named person's wallet, habits or P&L without their written consent.** It is public data, but
   the rules bar defamatory content (rules s.12) and it is a bad look regardless. User share cards
   are posted by the user, or by us with written consent, never otherwise.
2. **"Copy this wallet", or anything that reads as a recommendation.** Agon describes behaviour. It
   does not tell anyone what to buy.
3. **A token, points or airdrop teaser.** It adds legal and due-diligence risk (rules s.13) for no
   judging benefit, and prize receipt depends on that diligence.

## Before posting

Every item is checkable by the person posting, in under a minute. The acceptance for this task is
counted in posts, so these are the checks that make the count mean something.

- [ ] Every number in the post comes from a run that is published in the repo.
- [ ] Every benchmark number carries the repo commit hash and the one-command rerun.
- [ ] No latency number appears without its accuracy number in the same sentence.
- [ ] No named person's wallet, habits or P&L, unless written consent is on file and linked.
- [ ] Nothing reads as a recommendation to buy or copy anything.
- [ ] No token, points or airdrop language, including jokes.
- [ ] Nothing claims faster execution, only faster decisions.
- [ ] No em dashes or en dashes.
- [ ] Mirrored as a Colosseum project update the same day.

## Why this is a task and not a vibe

UX and Business plan are judged criteria, and the demo video is how judges see everything else. The
posts are also the public half of the pre-registration promise: scenarios and thresholds are
committed before the first run, and the commit hash in each post is what lets a sceptic check that
we did not move the goalposts after seeing the result.
