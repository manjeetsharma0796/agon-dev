# Demo script, 3 minutes

The submission video and the live demo run this script. Per the PRD day-1 move: write the script
first, then work backwards from it. **Anything not in this script is a candidate to cut at every
checkpoint.** If a beat cannot be filmed honestly, the beat changes, not the truth.

Total 180 seconds. Every beat is timed, and the times are a budget, not a description: a beat that
runs long takes its seconds from a named beat below, never from the total.

Recorded against team wallets only, capped at $50 each per the PRD, so the demo never puts
third-party funds at risk. The wallet history shown is a team member's own, from OP-1.

## The beats

| # | Start | Secs | On screen | The line |
|---|---|---|---|---|
| 1 | 0:00 | 20 | A real wallet's stop discipline, and the dollar cost of its exceptions | "You set a stop. Why don't you keep it?" |
| 2 | 0:20 | 30 | Paste an address, the report builds | "This is your own history, decoded from on-chain balance changes. Not a survey, not a guess." |
| 3 | 0:50 | 35 | An agent calls `check_trade`: one normal trade passes, one rule break is blocked, one dangerous token is blocked | "Every number here is arithmetic. A model is asked three questions, and none of them is a number." |
| 4 | 1:25 | 30 | The wallet signs a capped Swig role plus a Jupiter Trigger order | "Your key never leaves your wallet. The agent gets a capped role, and the 24/7 rules are Jupiter orders, not our servers." |
| 5 | 1:55 | 25 | Injection tricks the agent into skipping the check, and the on-chain cap still holds | "This is the layer that assumes every layer above it failed." |
| 6 | 2:20 | 20 | One wallet signature removes every Agon role | "Revoking needs nothing from us. You do not have to trust that we will let you out." |
| 7 | 2:40 | 20 | The benchmark table, the commit hash, the one-command rerun | "One hundred scenarios, committed before the first run. Every run published, including the ones we lose." |

## What each beat needs before it can be filmed

A beat is filmable when its row is `done` and its gate has passed. Until then it is "coming soon"
in the cut, never "N/A", per the PRD.

| # | Needs | Gate |
|---|---|---|
| 1 | T-A01 decoder, T-A02 FIFO ledger, T-A03 miner, plus OP-1 history | F1, F2 |
| 2 | T-A04 report store, T-E04 report page | F1 at CP1 |
| 3 | T-C06 guard, T-C07 MCP server | F3, F4, F11 |
| 4 | T-D01 Swig role, T-E06 arming UI | **F5 and F6 both pass. No arming UI before that, and the beat changes shape if either fails.** |
| 5 | T-D01 plus T-C05 injection screen | F5 |
| 6 | T-D03 kill switch, T-E07 revoke from the wallet | F5 |
| 7 | T-B03 harness, T-B04 benchmark A, T-B05 benchmark B | F9 reproducibility |

Beat 4 is the one with a real chance of changing. If F5 or F6 fails, the arming beat becomes a
simulation clearly labelled as one, and the claim narrows to the checking layer. Decide that at the
checkpoint, not while filming.

Beat 5 is the beat worth protecting. Beats 2 and 3 exist in other products; the on-chain cap
surviving a successful injection is the one nobody else shows.

## Rules for the narration

From the PRD, and they are not stylistic:

- **Never claim faster execution.** We route through Jupiter and add checks, so a guarded trade is
  at best at parity. The claim is decision speed: our safety verdict is faster than the LLM-guard
  verdict most agent frameworks use, at equal or better accuracy.
- **No latency number without its accuracy number in the same sentence.** Not in the video, not in
  the post, not in the thread.
- Say "Jev handles the judgement; every numeric check is plain arithmetic." Never say "AI decides
  your trades."
- Any benchmark figure spoken aloud is a figure from a published run, with the commit hash on
  screen. No placeholders, no rounded-up numbers.
- Nothing is called non-custodial in a beat where the key does anything but stay in the wallet.

## Cut order

When a checkpoint takes seconds away, they come off in this order, and beat 5 is the last thing to
go:

1. Beat 2 detail, down to 20 seconds (show the finished report, not the build)
2. Beat 7, down to 12 seconds (the table and the hash, no narration of the method)
3. Beat 1, down to 12 seconds (the number, not the story)
4. Beat 4, down to 20 seconds (the signature, not the explanation)
5. Beat 6, down to 12 seconds
6. Beat 3, never below 25 seconds
7. Beat 5, never cut

## Scenario list

The benchmark scenarios this demo quotes are in `benchmark/scenarios/scenarios.json`: 100
scenarios, 40 normal trades inside the profile, 30 dangerous tokens, 30 rule breaks, pre-registered
on 2026-09-24. The commit that added that file is the hash quoted in every published post.
