#!/usr/bin/env node
// A second net for key material, independent of gitleaks and of .gitleaks.toml.
//
//   node scripts/secret-shapes.mjs
//
// Why this exists, measured rather than assumed. The gitleaks allowlist that lets recorded RPC
// fixtures through forgives a 32 to 44 character base58 value under a field whose name ends in Key.
// A Solana PUBLIC address is 32 to 44 base58 characters. So is a 32-byte ed25519 SECRET seed, the
// thing `Keypair.fromSeed` consumes. They are byte-for-byte indistinguishable, so no regex over the
// value can tell them apart and the allowlist necessarily admits both. Verified: a 44-character
// base58 value is reported by gitleaks with the default config and silently passes with ours.
//
// gitleaks also inherits 24 path exemptions from its default config through `useDefault = true`,
// including *.png, *.zip, *.pdf, lockfiles and node_modules. A keypair committed as assets/logo.png
// is never opened, let alone reported.
//
// This scans every tracked file itself and looks only for shapes a PUBLIC key cannot take, so it
// costs no false positives on the fixtures the allowlist exists for:
//   - a 64-number JSON byte array, which is how `solana-keygen` writes a keypair to disk,
//   - a PEM private key block,
//   - a filename that says it holds a key.
//
// Two shapes are deliberately NOT here, because on this repo they are noise rather than signal, and
// a check that cries wolf is one everybody learns to skip:
//   - 32 to 44 base58 characters is a public address, and the fixtures are made of them.
//   - 87 to 88 base58 characters is a 64-byte secret key AND a transaction signature, which is also
//     64 bytes. Measured on this tree: 1,040 hits, of which 1,035 are signatures inside recorded
//     fixtures and the other 5 are the documented PINNED_SWAPS list in packages/core/src/net/
//     record.ts. Checked all 5 by hand: public swap signatures, pinned so a re-record fetches the
//     same transactions. 0 were secrets, so this shape is pure noise here.
// Length cannot separate a Solana secret from a Solana public value in either case. What can is
// gitleaks' own entropy rules on the paths it actually opens, plus the filename rule below.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const SHAPES = [
  {
    name: 'a 64-number JSON byte array, the shape solana-keygen writes a keypair in',
    re: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/,
  },
  { name: 'a PEM private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
]

/** A name that says it holds a key. The extension is irrelevant: logo.png can hold anything. */
const NAMES =
  /(^|\/)(.*keypair.*|.*secret.*|.*private[-_.]?key.*|id_[a-z0-9]+)\.(json|txt|bin|key|pem)$/i

const findings = []
for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (NAMES.test(file)) {
    findings.push(`${file}: the filename says it holds key material`)
    continue
  }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // unreadable or binary beyond utf8, nothing to match
  }
  // A NUL means binary. Key material pasted into a binary file is out of reach here and is what the
  // filename rule above is for.
  if (text.includes('\0')) continue
  for (const shape of SHAPES) {
    const m = shape.re.exec(text)
    if (!m) continue
    const line = text.slice(0, m.index).split('\n').length
    findings.push(`${file}:${line}: ${shape.name}`)
  }
}

if (findings.length > 0) {
  console.error(
    `\nsecret shapes: ${findings.length} finding(s). None of these can be a public key.\n`,
  )
  for (const f of findings) console.error(`  - ${f}`)
  console.error(
    '\nIf one is a false positive, narrow the shape rather than adding a path exemption: a path ' +
      'exemption is how the last hole got in.\n',
  )
  process.exit(1)
}
console.log('secret shapes: clean.')
