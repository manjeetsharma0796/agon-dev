# spikes

One folder per feasibility test, `F1` to `F11`. Each holds `thresholds.json`, written in the
spike task's **first** commit before the spike runs, and `result.json`, written by the run.
`scripts/spike.mjs F<n>` runs one; `scripts/feasibility.mjs` turns them into FEASIBILITY.md.

A folder with no `run.mjs` reports "not run". Nothing here writes a `result.json` it did not
measure.
