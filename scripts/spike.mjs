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
import { pathToFileURL } from 'node:url'

const id = process.argv[2] ?? ''
if (!/^F\d+$/.test(id)) {
  console.error('usage: node scripts/spike.mjs F<n> [--offline]')
  process.exit(2)
}

const entry = `spikes/${id}/run.mjs`
if (!existsSync(entry)) {
  console.log(`${id}: not run, there is no ${entry} yet. FEASIBILITY.md reports it as not run.`)
  process.exit(0)
}

await import(pathToFileURL(entry).href)
