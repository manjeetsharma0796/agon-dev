# DECISIONS.md

Every decision taken after the PRD was written, in the PRD's own shape: date, topic, decision,
why. `PRD.md` is the product; this is the log of what changed since it was first written on
2026-09-23. **Where the two disagree, this file wins, because it is dated**, and `PRD.md` is then
corrected to match.

**Hand-written, append-only, newest last.** Nothing here is derived from another file, on purpose.
`scripts/board.mjs` records why the last derived board file was removed: it held a summary
computed from the Status lines a claim moves, the check ran against the merge commit, and every PR
went stale the moment anyone else's claim landed. A log generated from `OPERATOR_TODO.md` has the
same shape and would fail the same way, because every board PR adds an OP row.

So the only rule is a lint rather than a generator: **an OP whose Status starts with `decided`
must have a row here naming it**, and `node scripts/board.mjs` fails otherwise. Add the row in the
same PR as the decision. If two PRs add a row at once, git conflicts on the last line of the table
and the resolution is to keep both rows.

The Why column is one sentence. The reasoning, the measurements and the options that lost are on
the OP row, which is what the last column points at.

| Date | Topic | Decision | Why | From |
|---|---|---|---|---|
| 2026-09-25 | F5 cannot run on devnet | Run F5 on a Surfpool mainnet fork | The pinned Jupiter id is not a program on devnet, `executable: false` and system-owned, so the cap cases cannot run there at any funding level | OP-20 |
| 2026-09-25 | Execution mode | The user chooses: agent unattended, user reviews then signs, or alerts only. One stack serves all three | Forking the stack per mode doubles the surface that can move funds, and the mode is a preference rather than an architecture | OP-26 |
| 2026-09-26 | Who names the spending cap | The miner suggests it, `arm_rule` returns a link to the arming screen, the user sets and signs it there. The agent can never name a cap | People approve pre-filled numbers, so a cap proposed by a model and signed by a tired user is still a cap chosen by a model | OP-27 |
| 2026-09-26 | Trigger order deposits | The owner places the Trigger order at arm time and the agent's cap is not involved | A Trigger deposit does not touch the allowance, measured 500000000 before and after a 100000000 deposit, so granting the agent that program would hand it a way to move funds the cap cannot see | OP-29 |
| 2026-09-26 | The cap allows 2x across a window edge | Arm exactly the number the user typed and print the rolling worst case beside it | Windows align to the slot clock, so 0.5 per 150 slots permits 1.0 in about 2 slots, measured at 0.9 in 37 slots. It is a wording defect and it is fixed in wording | OP-32 |
| 2026-09-27 | Helius plan | Stay on the free tier, and use Surfpool wherever a fork answers the question instead of an API | The paid tier buys throughput we do not need yet, and the accepted risk is written on the row rather than discovered later | OP-2 |
| 2026-09-27 | Licence | MIT | Confirms the assumption the PRD already makes rather than choosing something new | OP-13 |
| 2026-09-27 | Where the demo and the testers run | Live arming on a Surfpool mainnet fork, for both, until every mainnet gate passes | Arming on the fork is measured end to end with a real Phantom, so the demo needs no simulation caveat, and T-D04 has 8 boxes with 0 ticked | OP-21 |
| 2026-09-29 | What the Jupiter-only role gates | Every instruction that uses the vault's authority; one that uses none of it is not gated and cannot act on the vault | Measured: an SPL Approve through the agent role was refused by Swig with 0xbbe and the Token program was never invoked, while the identical Approve through root landed and set the delegate. A memo with 0 accounts and no signer was authorised, and only this rule explains both | OP-28 |
| 2026-09-28 | The arming gate | Amended from "until F5 and F6 pass" to "until its shape is known", with T-D04 unchanged | The shape is measured on a fork with a real Phantom, and F5's open case decides what we may claim the role prevents rather than what the screen looks like | T-B15 |
| 2026-09-28 | Where decisions live | This file, hand-written and append-only, with a lint that every decided OP appears in it | The PRD's log is a page in a PDF outside the repo with no URL recorded anywhere, so 8 decisions accumulated with nowhere to go | T-B13 |

## Still open, and dated

These are decisions the board is waiting on rather than ones taken. They are listed so a reader of
this file is not misled into thinking everything is settled.

- **OP-28**, whether the Jupiter-only role gates every call or only calls that move value. Not
  answerable by wording: a memo instruction is authorised today, and whether every no-value
  instruction is harmless is a measurement nobody has taken. Owner Manjeet.
- **OP-27's follow-up**, whether Swig can cap a second program at all. If it can, the agent
  managing its own Trigger orders inside a cap becomes the better product and OP-29 is revisited.
