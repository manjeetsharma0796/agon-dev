# Contract examples

Hand written examples of the three frozen contracts, one file each. They are not recorded chain
data and must never be read by the benchmark or the demo path: `fixtures/golden/` holds the
hand-verified ledgers with their source slot, and that is what published numbers come from.

Their job is to fail when a contract changes shape. `contracts.test.ts` parses every file here
against its schema, so a renamed or retyped field breaks the build with the field name in the error.
