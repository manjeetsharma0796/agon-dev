// The agon CLI. Owned by T-C09.
//
// Cold start is a gate (300 ms in CI), so this entry pulls in nothing it does not need. Every
// subcommand T-C09 adds loads its own work behind a dynamic import, or the gate starts failing
// for reasons that have nothing to do with the command being run.
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(version)
} else {
  console.log(`agon ${version}. No commands yet, they arrive with T-C09.`)
}
