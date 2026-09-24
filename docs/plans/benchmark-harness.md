# T-B03, benchmark harness on a pinned mainnet fork

Plan first, because this is longer than a day and because its hardest requirement is not "run the
benchmark", it is "two runs produce identical verdicts". Everything below that matters was measured
on 2026-09-24 against a real fork, not read in a doc.

## What was verified, with numbers

| Question | Answer |
|---|---|
| Does Surfpool run on the team's machines? | Yes. v1.6.0, prebuilt `surfpool-windows-x64`, `surfpool 1.6.0`, no toolchain and no compile |
| Can it fork mainnet from our own RPC? | Yes. `--rpc-url <helius>` came up at slot 450010819, `solana-core 4.2.1` |
| Does it materialise real mainnet accounts? | Yes. One `getMultipleAccounts` for the 30 benchmark mints returned **30 of 30** |
| Can a run be pinned so the next one sees the same state? | Yes, via snapshots. `surfnet_exportSnapshot` returned **294 accounts, 290 carrying real data**, 277 KB, stamped `context.slot: 450010903` |
| Is there a flag that pins a fork to one slot directly? | **No.** This is the finding the plan turns on |

## The finding, and what it changes

There is no `--at-slot` flag. A bare fork is lazy: an account is fetched from the datasource the
first time something touches it, at whatever slot the datasource is on right then. Two runs an hour
apart would therefore see different prices and different accounts, and the benchmark's whole claim
is that they do not.

`--snapshot` is the answer, and it is a better one than a slot flag would have been:

1. **Record once.** Fork from Helius, touch every account the 100 scenarios need, then
   `surfnet_exportSnapshot`. The export carries `context.slot`, so the snapshot states the slot it
   was taken at rather than us asserting it.
2. **Commit the snapshot** under `benchmark/` as the pinned state.
3. **Every run starts from it**: `surfpool start --snapshot <file>`. Identical accounts, and no
   datasource call for anything the snapshot already holds, so a run needs **no Helius key**.

That last point is what makes F9 real. A sceptic clones the repo and reruns the numbers without
being given a key, which is the difference between a reproducible benchmark and a screenshot.

Two consequences worth stating before anyone builds against them:

- `--block-production-mode` defaults to `clock`, so slots advance on their own at `--slot-time`
  400 ms. The runner sets these explicitly rather than inheriting them, or two runs drift apart on
  timing alone.
- A snapshot entry may be `null`, which means "fetch this one from the remote RPC". A null entry in
  a committed snapshot is a silent hole in reproducibility, so the harness rejects any snapshot
  containing one instead of trusting it.

## This unblocks something else

T-E01 committed 100 scenarios with **every `token.mint` null**, because a mint chosen before the
fork slot existed would have been invented data. The snapshot's `context.slot` is that slot. Once
this lands, T-E01's scenarios bind their selectors to real mints at that exact slot, and the test
already in place flips from requiring 0 bound mints to requiring 100.

## Order of work

1. `benchmark/snapshot/` plus the recorder that produces it, and the null-entry check.
2. `benchmark/runner/`, one command, reading the scenario file and the snapshot.
3. `benchmark/arms/`: arm 1 (agent alone) only. Arms 2 and 3 need `check_trade` (T-C06) and the
   Swig cap (T-D01), neither of which exists, so they are declared and left unimplemented rather
   than stubbed to return a passing verdict.
4. The CI check that nothing under `benchmark/` or the demo path reads a fixture marked
   `synthetic: true`.
5. Evidence: two runs, identical verdicts, diffed.

## What this plan does not solve

- **OP-9 is open**, so the benchmark agent's model is not pinned. Until it is, arm 1 is reproducible
  in its accounts and prices but not in the agent's choices, and the "2 runs, identical verdicts"
  evidence can only cover the deterministic half.
- Arms 2 and 3 are the point of Benchmark A (the third arm is where the on-chain cap holds after an
  injection beats the guard), and neither is buildable yet. This task delivers the harness they
  plug into, not the comparison.
- The kill criterion already names the fallback: publish the deterministic half, guardrail verdicts
  on fixed trades, and drop the live-agent comparison. Nothing measured here changes that.
