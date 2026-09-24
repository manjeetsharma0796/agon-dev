# fixtures/golden

Hand-verified ledgers. Every file states where it came from: a `"slot"` (or `"sourceSlot"`) it
was recorded at, or `"synthetic": true` if it was made up. CI fails on a fixture that says
neither, and fails again if anything on the benchmark or demo path reads a synthetic one.
