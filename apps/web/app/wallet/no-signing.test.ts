// T-E14's acceptance: 0 signature prompts from connecting a wallet. The only way this screen could
// raise one is by reaching a signing feature, so the test reads every source file behind the
// screen and fails on any of them. Arming is T-E06, gated on F5 and F6, and a signature showing up
// here would be that task arriving early by the back door.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const APP = new URL('..', import.meta.url).pathname
const SCREEN = ['wallet', '(onboarding)']
const SIGNING =
  /signTransaction|signAllTransactions|signAndSendTransaction|signMessage|signIn|solana:sign/

const sources = SCREEN.flatMap((dir) =>
  readdirSync(join(APP, dir))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
    .map((f) => join(APP, dir, f)),
)

test('the connect screen has sources to check, so this cannot pass by reading nothing', () => {
  expect(sources.length).toBeGreaterThanOrEqual(3)
})

test('nothing behind the connect screen can reach a signing feature', () => {
  for (const file of sources) {
    const hit = SIGNING.exec(readFileSync(file, 'utf8'))
    expect(hit?.[0], `${file} mentions ${hit?.[0]}`).toBeUndefined()
  }
})
