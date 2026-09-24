import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// The gap this closes: vitest resolves a dependency through its `module` field and node resolves it
// through `main`. @swig-wallet/classic ships both, and they are not the same file. Every other test
// in this package therefore proved the logic while the built package threw on its first import in a
// real node process, and typecheck agreed with the tests because TypeScript reads the .d.ts.
//
// So this one runs node, not vitest, against the built output. It is slow and it is worth it: the
// thing it catches cannot be caught any other way from inside the test runner.

test('the built chain package can actually be imported by node', () => {
  const script = `
    // The built output by path: a package cannot resolve its own name without an exports field,
    // and it is the built file that ships anyway.
    const m = await import('./dist/index.js')
    if (typeof m.agentRoleActions !== 'function') throw new Error('agentRoleActions is missing')
    if (typeof m.planRevokeAll !== 'function') throw new Error('planRevokeAll is missing')
    // Call it, so a lazily thrown interop error cannot hide behind a successful import.
    m.agentRoleActions({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', recurringAmount: 1n, window: 2n })
    console.log('ok')
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    // fileURLToPath, not URL.pathname: pathname keeps the percent encoding, so any checkout
    // whose path contains a space spawns into a directory that does not exist.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(out.trim()).toBe('ok')
})
