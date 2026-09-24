#!/usr/bin/env node
// Runs one feasibility spike:  node scripts/spike.mjs F1 [--offline]
//
// A spike whose task has not landed yet is "not run", not a failure. FEASIBILITY.md already has
// that state (it is what an absent result.json means), and failing here instead would hold every
// PR red until all 11 spikes exist, which is the opposite of what the gate is for.
//
// The one thing this must never do is write a result.json it did not measure. A result.json is
// read as a measurement that actually happened, so an unimplemented spike leaves no trace.

import { existsSync } from 'node:fs'

const id = process.argv[2] ?? ''
if (!/^F\d+$/.test(id)) {
  console.error('usage: node scripts/spike.mjs F<n> [--offline]')
  process.exit(2)
}

// Resolved against this file, not the working directory. Run from anywhere else a cwd-relative
// path finds nothing and this reports a spike that does exist as "not run", which is the one
// wrong answer the script is here to prevent.
const rel = `spikes/${id}/run.mjs`
const entry = new URL(`../${rel}`, import.meta.url)
if (!existsSync(entry)) {
  console.log(`${id}: not run, there is no ${rel} yet. FEASIBILITY.md reports it as not run.`)
  process.exit(0)
}

await import(entry.href)
