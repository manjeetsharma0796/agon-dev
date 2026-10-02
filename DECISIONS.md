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
| 2026-09-29 | CI blocked by Actions billing | Make `dev` public until billing is fixed, then private again; the ruleset stays as it is | Public repos get Actions free, and every PR was blocked, while pausing the required checks would have left no scan for leaked keys | OP-36 |
| 2026-09-29 | How the MCP finds a wallet's vault | The Swig id is derived from the wallet address at arm time, so the vault is recomputed from the wallet, no search | 1 account read and no index, at the cost of 1 Agon vault per wallet | OP-35 |
| 2026-09-29 | Vault lookup, amended | A Swig at a wallet's derived id is that wallet's vault only if the wallet holds root on it; otherwise the next of 8 ids is tried, through 1 shared `resolveVault` | Swig ids are not access-controlled: an attacker's Swig at a victim's derived id landed on the fork, and trusting the id would have returned it as the victim's vault | OP-35 |
| 2026-09-29 | How the MCP reaches the chain | 1 setting, `AGON_RPC_URL`; unset means "no chain configured", and a URL that disagrees with `AGON_NETWORK` stops the server | It works locally, in compose and hosted, and the network label can never disagree with the data | OP-35 |
| 2026-09-29 | Extending ArmedRule | Add `vault`, `effectiveRemaining` and `rollingWorstCase`; change nothing existing; fixtures in the same commit | The smallest change to a frozen contract that lets `list_rules` show the real allowance, agreed by both owners | OP-35 |
| 2026-09-29 | ArmedRule read back from chain | `spec` becomes nullable and `RecurringLimit` takes `windowSeconds` or `windowSlots`, at least 1 | The chain stores the role but not the trigger type, expiry or order id, and counts windows in slots; converting would guess a slot time | OP-35 |

## Still open, and dated

These are decisions the board is waiting on rather than ones taken. They are listed so a reader of
this file is not misled into thinking everything is settled.

- **OP-28**, whether the Jupiter-only role gates every call or only calls that move value. Not
  answerable by wording: a memo instruction is authorised today, and whether every no-value
  instruction is harmless is a measurement nobody has taken. Owner Manjeet.
- **OP-27's follow-up**, whether Swig can cap a second program at all. If it can, the agent
  managing its own Trigger orders inside a cap becomes the better product and OP-29 is revisited.
| 2026-09-29 | Team trading history | Paused until the fork tests are done | Real history for the report comes from the replacement public wallet in OP-31 meanwhile, so waiting costs nothing | OP-1 |
| 2026-09-29 | Jupiter API key | Stay on the free tier for now | The fork work fits inside 10 quotes per 10 seconds; the key is asked for when a benchmark needs the throughput | OP-3 |
| 2026-09-29 | Jev provider | TypeSafe direct, the endpoint already measured | It is the only provider measured, at about 650 ms p50, and the intensive accuracy test needs one provider pinned before it runs | OP-4 |
| 2026-09-29 | Mainnet test wallets | Funding paused until after the fork tests | No mainnet transaction happens before T-D04 anyway, so funding early only creates a wallet to guard | OP-5 |
| 2026-09-29 | Database | Neon Postgres, free tier | The report cache, beta metrics and rule feedback need somewhere to persist, and the free tier covers a hackathon-sized cohort | OP-6 |
| 2026-09-29 | Public repository | Push to the existing public repo once a working version exists | Publishing a half-working build invites judges to judge that build | OP-7 |
| 2026-09-29 | Beta recruiting | Deferred until onboarding works on the hosted fork | A recruit with nothing to try is a recruit lost | OP-8 |
| 2026-09-29 | LLM-guard baseline model | MiMo v2.6 Flash via opencode | Free to run, and recording the served version per call keeps a free tier's silent upgrades visible | OP-9 |
| 2026-09-29 | Team leader | Jishnu | Prizes are paid only to the team leader, rules section 15 | OP-10 |
| 2026-09-29 | Beta terms reviewer | Deferred until onboarding works on the hosted fork | Terms are needed before a user arms on mainnet, which is behind T-D04 and the fork work | OP-11 |
| 2026-09-29 | RugCheck token | Dropped | No rate limit was ever hit, and RugCheck is enrichment, never on the deciding path | OP-15 |
| 2026-09-29 | Second person on the product track | Deferred until onboarding works on the hosted fork | The functional onboarding comes first and is one person's work | OP-16 |
| 2026-09-29 | Web hosting | Not now; outside testers use the hosted fork | Hosting a waitlist and staging stack before the onboarding works spends time on the wrong layer | OP-17 |
| 2026-09-29 | Waitlist | Parked | The onboarding flow is the priority, and a waitlist for a product that does not run yet collects nothing useful | OP-18 |
| 2026-09-29 | Jev's 3-question rule | Scoped to the trading guard; batching measured in T-F11a | T-B08's questions never reach check_trade and never carry a number, so the rule's reason does not apply to them | OP-24 |
| 2026-09-29 | Contract shapes from the outside agent | Carry severity on each reason; leave arm_rule's shape | An agent must tell the 1 reason that caused a block from the 2 that fire on every call, and the guard already computes it | OP-25 |
| 2026-09-29 | Rule expiry | Swig's native expiry only; the pre-signed removal is cut | The native expiry measured holding on chain, and one mechanism is less signing code to review before mainnet | OP-30 |
| 2026-09-29 | F1's replacement wallet | Claude picks it by the written test; a person verifies the rows | Picking against a stated test is checkable, but hand-verifying our own decoder's output is not something the decoder's author can do honestly | OP-31 |
| 2026-09-29 | Hosted fork reset period | Wipe nightly | Hours of trading drift the fork's pools from live prices, which is what broke F5 case (e), while testers need their vault to last a session | OP-33 |
| 2026-09-29 | Who builds the trade | Both: MCP tool 5 and the CLI, in parallel | Agents with no CLI get a working path at once, and the daemon still needs a local builder for its re-quote | OP-34 |
| 2026-09-29 | Issuer stablecoins and live authorities | Pinned issuer allowlist; unsure for every other live authority | The mint account cannot tell Circle from an anonymous deployer, and only the address can | OP-37 |
| 2026-09-29 | Jev's text screen | Measure intensively before wiring anything | 5 of 5 real tokens were flagged as injections, so the question is where Jev helps, not whether to switch it on | OP-38 |
| 2026-09-29 | Two hackathons | The same project enters both the World's Fair and the fall hackathon | Confirmed with Colosseum, per Jishnu | OP-12 |
| 2026-09-29 | Filming the end-to-end slice | The team films it outside this board | It is a team activity, not a task an agent can advance | OP-22 |
| 2026-09-29 | Issuer allowlist for authorities | Not built: USDC already passes with a quote and a clean screen | Its authorities were notes all along; the gates are the quote and the text screen, so an allowlist would change nothing for authorities and belongs to impersonation instead | OP-37 |
| 2026-09-29 | Jev in the trading path | Out. Category and impersonation are lookups; token text never reaches the agent | On 140 labelled cases no question design both passed real tokens and stopped attacks, and lookups are deterministic, fast and cost no model call per trade | OP-38 |
| 2026-09-30 | A trader with no history, on the practice fork | Not refused: prepare_swap builds the trade unchecked against a history, bounded only by the cap the owner signed on chain, and its verdict's first reason, no-trading-history, says so. Every other check_trade finding is reported and stops nothing. Mainnet unchanged: it still fails closed, and T-D04 gates it | Decided by manjeetsharma0796: a first-time trader has no history, so mined rules refused every one of their trades and the fork could not be tried at all; the money is fake there, and the on-chain cap still binds | T-C21 |
| 2026-10-01 | Grow the MCP tool list from 5 to 7 | vault_status and sync_fork, appended after prepare_swap so the first 5 keep their order | Decided by manjeetsharma0796: a user asked the agent for balances, trade P&L, explorer links and a way to resync a stale fork; 2 tools cover the 4 asks, and each new tool costs every client a cache miss once | T-C25 |
| 2026-10-02 | vault_status's answer, revised once while no outside client depends on it | P&L by FIFO over every vault trade with wSOL as the only quote; realised exact from the chain, open positions valued from a fallback chain of price sources, dollars from 2 SOL/USD sources; every amount in base units, a decimal string and a unit | Decided by manjeetsharma0796: 1 sell made the total null, and a bare base-unit figure was read with the wrong decimals by an agent. Changing it now, 1 day after it shipped, costs nobody | T-C27 |
| 2026-10-03 | Grow the MCP tool list from 7 to 8, and the journal's shape | get_activity appended after sync_fork so the first 7 keep their order; 1 journal table in Neon, 1 row per check_trade call and per action, by mint with amounts in base units and no field for token text, read only with an ed25519 signature over a 60 s single-use server nonce by the wallet or a key its vault hires on chain | Decided by jishnu-baruah in the Agon terminal plan: the person and the agent read the same record, and that record shows what the agent tried and was refused, so it is not public the way balances are | T-C30 |
