# Contract fixtures

Hand written examples of the three frozen contracts, one file each. Every file declares
`"synthetic": true`, because nothing under `fixtures/` may hide where it came from, and these
came from a keyboard rather than the chain.

They must never be read by the benchmark or the demo path, and CI enforces that: published
numbers come from `fixtures/golden/`, which carries the source slot of every recorded read.

Their job is to fail when a contract changes shape. `packages/core/src/contracts.test.ts` parses
every file here against its schema, so a renamed or retyped field breaks the build with the field
name in the error.
