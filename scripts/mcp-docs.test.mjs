import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The tool reference is generated from the frozen contracts, so the only way it can be wrong is by
// being stale. That is exactly the failure a hand-written doc has and a generated one is supposed
// to remove, so it is checked rather than assumed.

test('the published MCP tool reference is current', () => {
  const out = execFileSync('node', ['scripts/mcp-docs.mjs', '--check'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  expect(out).toContain('is current')
})

test('it documents every tool, and nothing the server does not expose', async () => {
  const { TOOLS } = await import('../packages/core/dist/index.js')
  const doc = readFileSync('docs/public/mcp-tools.md', 'utf8')
  const documented = [...doc.matchAll(/^## `([a-z_]+)`$/gm)].map((m) => m[1])
  expect(documented).toEqual([...TOOLS])
})

test('it carries the response budgets CI enforces, so an integrator sees them', () => {
  const doc = readFileSync('docs/public/mcp-tools.md', 'utf8')
  expect(doc).toContain('2,000 tokens')
  expect(doc).toContain('400 tokens')
})

test('the quickstart does not promise a signature that read-only paths never ask for', () => {
  const doc = readFileSync('docs/public/quickstart.md', 'utf8')
  expect(doc).toContain('No account, no login, nothing to sign')
  expect(doc).toContain('never holds `manageAuthority`')
  for (const banned of ['connect your wallet', 'sign in', 'create an account']) {
    expect(doc.toLowerCase(), `the quickstart says "${banned}"`).not.toContain(banned)
  }
})
