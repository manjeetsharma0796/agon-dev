#!/usr/bin/env node
// The agon CLI. Owned by T-C09.
//
// Cold start is a gate (300 ms in CI), so this entry pulls in nothing it does not need. Every
// subcommand T-C09 adds loads its own work behind a dynamic import, or the gate starts failing
// for reasons that have nothing to do with the command being run.
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const [command] = process.argv.slice(2)

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(version)
} else if (command === 'check') {
  // Dynamic for the same reason as the others: the guard pulls in the decoder and the miner, and
  // none of that belongs inside the cold start gate for `agon --version`.
  const [{ runCheck }, { liveCheckIo }] = await Promise.all([
    import('./commands/check.js'),
    import('./commands/report-io.js'),
  ])
  process.exitCode = await runCheck(process.argv.slice(3), liveCheckIo())
} else if (command === 'revoke') {
  // Dynamic, so the chain package and the Swig SDK are only loaded when somebody actually revokes.
  // Importing them at the top would put the whole SDK inside the 300 ms cold start gate for every
  // invocation, including `--version`.
  const { runRevoke } = await import('./commands/revoke.js')
  process.exitCode = await runRevoke(process.argv.slice(3))
} else if (command === 'agent-key') {
  // Dynamic like the others: the keychain binding and web3.js stay out of the cold start gate.
  const { runAgentKey } = await import('./commands/agent-key.js')
  process.exitCode = runAgentKey()
} else if (command === 'report') {
  // Dynamic for the same reason as revoke: the decoder and the miner must not sit inside the
  // 300 ms cold start gate that every invocation pays, including `--version`.
  const { runReport } = await import('./commands/report.js')
  const { liveIo } = await import('./commands/report-io.js')
  process.exitCode = await runReport(process.argv.slice(3), liveIo())
} else {
  console.log(`agon ${version}. Commands: agent-key, check, report, revoke.`)
}
