# F9, benchmark reproducibility

**Reported as FAIL, because 1 of the 3 clauses cannot run at all.**

- Deterministic half: **30 of 30 guardrail verdicts identical across 2 runs**, each from its own
  surfpool process started `--offline` from the committed snapshot, pinned at slot 450049160, with
  no Helius key.
- Agent-side variance: **0 of the required 5 runs per scenario**, because OP-9 has not pinned a
  model.
- 1 command reproduces the first two: `node scripts/spike.mjs F9`.

The kill criterion names dropping the live-agent comparison as the fallback, and this run is what
that fallback looks like. Taking it is a CP2 decision, not one the spike awards itself, so
`FEASIBILITY.md` says FAIL and states both halves rather than calling a partial result a pass.

## What is actually being proved

Not that the guardrail is deterministic. It is a pure function over account data, so running it
twice on the same input proving the same answer is worth nothing.

The claim is that **the chain state it reads is pinned**. A bare mainnet fork is lazy: an account
is fetched from the datasource the first time something touches it, at whatever slot the datasource
happens to be on right then. Two runs a day apart would silently read different accounts and the
benchmark would report different numbers with nothing failing. So each run here starts from a
committed snapshot with `--offline`, which makes a datasource call impossible rather than merely
unnecessary, and the second run gets the same 30 verdicts as the first.

`--offline` is also the part that makes the number credible to somebody else: **this reruns with no
Helius key**, verified by running it with the key unset. That is the difference between a
reproducible benchmark and a screenshot.

## The finding: the snapshot cannot be round-tripped through JavaScript

`surfnet_exportSnapshot` returns `rentEpoch` as `u64::MAX`, `18446744073709551615`. That is larger
than `Number.MAX_SAFE_INTEGER`, so `JSON.parse` holds it as a float and `JSON.stringify` writes it
back as **`18446744073709552000`**, a different integer, wrong by 385, that still looks like a
perfectly ordinary u64. It appears **31 times** in this snapshot.

The first version of this spike did exactly that, and the committed file looked fine. Surfpool
refused it, which was luck: the refusal came from a *different* attempt where the value serialised
in scientific notation. A slightly more forgiving importer would have accepted a pinned state that
quietly disagreed with the chain it was taken from, and every run after that would have been
reproducibly wrong.

So `record.mjs` never parses the export. It finds the `"value"` object by matching braces over the
raw response text and writes those bytes out unchanged. Verified: 31 occurrences of the true value,
0 of the corrupted one.

Two smaller things worth writing down:

- **The CLI help is wrong about the format.** `--snapshot` says "The snapshot format matches the
  `surfnet_exportSnapshot` RPC output", but the RPC returns `{context, value}` and the importer
  wants the bare account map. Passing the export verbatim fails with ``missing field `lamports` ``.
- **The bare map has nowhere to record its own slot**, so `snapshot.meta.json` sits beside it. A
  pinned state that cannot say what it is pinned to is not evidence.

## The null-entry hole

A snapshot entry may be `null`, which means "fetch this one from the remote RPC". One null entry in
a committed snapshot is a silent hole in the pin: everything looks reproducible and one account
moves. `run.mjs` rejects any snapshot containing one rather than trusting it. Checked by planting a
null entry, which exits 1 and names the account.

## What is not measured

- **Agent-side variance across 5+ runs per scenario.** Needs a pinned model and a key, which is
  **OP-9**, open. T-B04 declares that dependency; T-F09's row does not, and should.
- **The 100 benchmark scenarios.** Every `token.mint` in them is still `null`, on purpose: T-E01
  would have been inventing data by choosing mints before a fork slot existed. This snapshot's slot
  is that slot, so binding them is now unblocked. Until then this spike runs the guardrail over the
  30 labelled mainnet mints F3 already committed, which are real and pinned the same way.
- **Arms 2 and 3**, which need `check_trade` (T-C06) and the Swig cap (T-D01). Neither exists, and
  neither is stubbed to return a passing verdict.

## Running it

```
SURFPOOL_BIN=/path/to/surfpool node scripts/spike.mjs F9   # no Helius key needed
node spikes/F9/record.mjs                                   # re-pin, needs a forked surfpool
```

Surfpool is not committed and is not on a PR runner, so without it the spike prints "not run" and
writes no `result.json`, which is what `FEASIBILITY.md` then reports.
