import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// Every failure an agent can meet on a tool path is a catalogue row, so its first sentence carries
// the cause and the number and the tests in packages/core hold it to that. An ad hoc string here
// would skip those tests, so this counts them.
const TOOL_PATHS = ['./index.ts', './io.ts', '../../../apps/web/src/legs.ts']

test('the MCP tool paths throw catalogue rows, never an ad hoc Error', () => {
  const adHoc: string[] = []
  for (const path of TOOL_PATHS) {
    const lines = readFileSync(new URL(path, import.meta.url), 'utf8').split('\n')
    lines.forEach((line, i) => {
      // The missing-fixture error is a broken checkout, never something an agent can cause.
      if (/new Error\(/.test(line) && !lines[i + 1]?.includes('fixture is missing'))
        adHoc.push(`${path}:${i + 1}`)
    })
  }
  expect(adHoc).toEqual([])
})
