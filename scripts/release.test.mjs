import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

// T-B01's finding was that a gate can look alive and be dead: the planted-key run found 0 leaks
// until the key was randomly generated, because gitleaks allowlists the documentation example.
// The release allowlist has the same failure mode, and a worse blast radius, because the thing it
// leaks cannot be unpublished. So the gate is not trusted for passing on a clean tree. It is
// trusted only because each of the 6 markers is planted and each one is caught.

const walk = (dir, root = dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, root, out)
    else out.push(full.slice(root.length + 1))
  }
  return out
}

const work = mkdtempSync(join(tmpdir(), 'agon-release-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const release = (...args) => {
  try {
    return {
      code: 0,
      out: execFileSync('node', ['scripts/release.mjs', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

// One copy of the real allowlisted tree, reused by every case. Each case plants into its own clone
// so a survivor from one marker cannot be mistaken for another's.
const clean = join(work, 'clean')
release('--out', clean)

const plant = (name, mutate) => {
  const tree = join(work, name)
  execFileSync('cp', ['-r', clean, tree])
  mutate(tree)
  return tree
}

test('the allowlist keeps the internal files out in the first place', () => {
  for (const path of [
    'TASKS.md',
    'OPERATOR_TODO.md',
    'FEASIBILITY.md',
    'CLAUDE.md',
    '.claude',
    'spikes',
  ]) {
    expect(existsSync(join(clean, path)), `${path} reached the public tree`).toBe(false)
  }
})

test('no build output is published, so the public build actually builds', () => {
  // Not tidiness. A published tsconfig.tsbuildinfo tells `tsc -b` on the stripped tree that every
  // project is up to date, so the release step whose whole job is proving the public tree compiles
  // would compile nothing and pass. Measured before the fix: `tsc -b --dry` said "is up to date"
  // for all 9 projects.
  const artifacts = walk(clean).filter(
    (f) => /(^|\/)(node_modules|dist)(\/|$)/.test(f) || f.endsWith('.tsbuildinfo'),
  )
  expect(
    artifacts,
    `build output reached the public tree: ${artifacts.slice(0, 5).join(', ')}`,
  ).toEqual([])
})

// Markers that are already in published source, each with the file that owns it. This is a
// ratchet, not an amnesty. A marker in a file that is not on this list fails, so nobody adds a
// new one. A file on this list that has become clean also fails, so the list cannot rot: fixing
// one means deleting its line in the same commit, and the list only ever gets shorter.
//
// `release.mjs --check` is not softened by any of this. A real release still refuses on all 6
// markers, and it refuses before the push, so nothing reaches the public repo either way. What
// this buys is catching a new leak at PR time instead of at release time.
const KNOWN = [
  // T-C02. 5 references to operator items across these 2 files, 1 of them inside a string that is
  // printed to whoever runs the recorder. Comment-only fixes to packages/core currently cannot
  // land: the board job requires a fixtures change alongside any packages/core diff, which a
  // reworded comment has no honest way to produce. Raised on the T-B02 PR.
  'OP-|packages/core/src/net/index.ts',
  'OP-|packages/core/src/net/record.ts',
]

test('no new internal marker reaches published source, and fixed ones leave the list', () => {
  // Through the CLI, like every other case here. release.mjs runs its argument parsing at import
  // time, so importing it for the one function would exit the test runner.
  const { out } = release('--check', clean)
  const here = [...out.matchAll(/^::error::(.+?): (.+?)(?::\d+)?$/gm)].map((m) => `${m[1]}|${m[2]}`)
  const added = here.filter((k) => !KNOWN.includes(k))
  const gone = KNOWN.filter((k) => !here.includes(k))

  expect(added, `a new internal marker reached published source:\n${added.join('\n')}`).toEqual([])
  expect(
    gone,
    `these are clean now, so delete them from KNOWN in this file:\n${gone.join('\n')}`,
  ).toEqual([])
})

// The 6 markers named in T-B02's acceptance. Planting is deliberately how each one really arrives:
// a file someone adds to the allowlist, or a line someone writes in a file already published.
const markers = [
  ['TASKS.md', (t) => writeFileSync(join(t, 'TASKS.md'), '# the board\n')],
  ['OPERATOR_TODO.md', (t) => writeFileSync(join(t, 'OPERATOR_TODO.md'), '# the human queue\n')],
  ['FEASIBILITY.md', (t) => writeFileSync(join(t, 'FEASIBILITY.md'), '# the spike dashboard\n')],
  [
    'OP-',
    (t) => appendFileSync(join(t, 'README.md'), '\nBlocked on OP-7 until the repo exists.\n'),
  ],
  [
    '.claude',
    (t) => {
      mkdirSync(join(t, '.claude'), { recursive: true })
      writeFileSync(join(t, '.claude/settings.json'), '{}\n')
    },
  ],
  [
    'internal URL',
    (t) =>
      appendFileSync(join(t, 'README.md'), '\nSee https://github.com/manjeetsharma0796/agon-dev\n'),
  ],
]

describe('every planted internal marker is caught', () => {
  for (const [name, mutate] of markers) {
    test(name, () => {
      const { code, out } = release('--check', plant(name.replace(/\W+/g, '-'), mutate))
      expect(out, `${name} was planted and the gate stayed quiet`).toContain(name)
      expect(code).toBe(1)
    })
  }
})

// The changelog is generated from dev's commit subjects during --push, which is after --check has
// already looked at the tree. Commit subjects carry OP-<n> and task ids as a matter of course, so
// this is the one file that can walk past a gate that has already said yes.
test('a marker in the changelog is caught, because it arrives after the first check', () => {
  const tree = plant('changelog', (t) =>
    writeFileSync(
      join(t, 'CHANGELOG-latest.md'),
      '# release-2026-09-25\n\n- Write the measured provider limits into OP-2, OP-3 and OP-4\n',
    ),
  )
  const { code, out } = release('--check', tree)
  expect(out).toContain('CHANGELOG-latest.md')
  expect(code).toBe(1)
})

test('an empty allowlist refuses to publish rather than publishing nothing', () => {
  // The worst outcome is not a leak, it is a green release that replaced the public repo with an
  // empty tree. Copying 0 paths has to be an error, never a successful no-op.
  const empty = join(work, 'empty-allowlist')
  mkdirSync(empty, { recursive: true })
  writeFileSync(join(empty, '.publicinclude'), '# nothing\n')
  const { code, out } = (() => {
    try {
      return {
        code: 0,
        out: execFileSync(
          'node',
          [join(process.cwd(), 'scripts/release.mjs'), '--out', join(empty, 'out')],
          {
            encoding: 'utf8',
            cwd: empty,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      }
    } catch (error) {
      return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
    }
  })()
  expect(out).toContain('Refusing to publish an empty tree')
  expect(code).toBe(1)
})
