# Contract fixtures

Hand written examples of the three frozen contracts, one file each, plus one second example of
`Report` for a wallet with nothing decoded, which is the case the `Coverage` contract used to
exempt from its own arithmetic. Every file declares `"synthetic": true`, because nothing under
`fixtures/` may hide where it came from, and these came from a keyboard rather than the chain.

They must never be read by the benchmark or the demo path, and CI enforces that: published
numbers come from `fixtures/golden/`, which carries the source slot of every recorded read.

Their job is to fail when a contract changes shape. `packages/core/src/contracts.test.ts` parses
every file here against its schema, so a renamed or retyped field breaks the build with the field
name in the error. `report-empty-wallet.json` is the exception that proves the rule: nothing about
its shape is new, and it exists because a rule about a value changed, so the test that reads it
also asserts the shape the contract now refuses.

Writing that file found a second number of the same family, left alone here because it is a
different contract and a different change: `Metrics` makes `medianSize` and `medianHoldSeconds`
required and not nullable, so a wallet with 0 closed trades has to report a median of 0, which
reads as a measured fact rather than as nothing to measure.
