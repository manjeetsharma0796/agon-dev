import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

// T-B01's finding was that a gate can look alive and be dead: the planted-key run found 0 leaks
// until the key was randomly generated, because gitleaks allowlists the documentation example.
// The release allowlist has the same failure mode, and a worse blast radius, because the thing it
// leaks cannot be unpublished. So the gate is not trusted for passing on a clean tree. It is
// trusted only because each of the 6 markers is planted and each one is caught.

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

test('a clean public tree passes, and says how many markers it checked', () => {
  const { code, out } = release('--check', clean)
  expect(out).toContain('0 of 6 internal markers survived')
  expect(code).toBe(0)
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
