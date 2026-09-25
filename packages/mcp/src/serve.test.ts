import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Spawns the real built server rather than calling a handler, for the same reason
// packages/chain's import test spawns node: `handle` is not exported and serve.ts starts listening
// on import, and the thing under test is what the deployed process does with a request method.
// Exporting the handler would mean moving where the server starts listening, which is the one
// process the Dockerfile runs, and this is a 404 on a health probe. Not worth that risk.

/** Fixed, not 0: with PORT=0 the server picks a port and the banner still prints the 0. */
const PORT = 8799

test('HEAD /health answers like GET, because probes use HEAD', () => {
  const script = `
    process.env.PORT = '${PORT}'
    process.env.HOST = '127.0.0.1'
    await import('./dist/serve.js')
    // The listen callback has not necessarily fired yet on import.
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:${PORT}/health'); break } catch { await new Promise(r => setTimeout(r, 100)) }
    }
    const get = await fetch('http://127.0.0.1:${PORT}/health')
    const head = await fetch('http://127.0.0.1:${PORT}/health', { method: 'HEAD' })
    console.log(JSON.stringify({
      get: get.status,
      getBody: await get.text(),
      head: head.status,
      headBody: await head.text(),
    }))
    process.exit(0)
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const seen = JSON.parse(out.trim()) as {
    get: number
    getBody: string
    head: number
    headBody: string
  }

  expect(seen.head, 'HEAD /health is the probe that was answered 404').toBe(200)
  // A HEAD response carries no body, so the fix must not write one.
  expect(seen.headBody).toBe('')
  // And GET is unchanged, or the fix traded one broken probe for another.
  expect(seen.get).toBe(200)
  expect(JSON.parse(seen.getBody)).toEqual({
    ok: true,
    server: 'agon',
    transport: 'streamable-http',
    path: '/mcp',
  })
})
