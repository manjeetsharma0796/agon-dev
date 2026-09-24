#!/usr/bin/env node
// dev -> the public main, by the .publicinclude allowlist.
//
//   node scripts/release.mjs --out /tmp/public     copy the allowlisted paths into a clean tree
//   node scripts/release.mjs --check /tmp/public   fail if any internal marker survived
//   node scripts/release.mjs --push /tmp/public    push that tree as one release commit
//
// An allowlist, not a denylist, so a new internal file stays private by default.

import {
  cpSync,
  globSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, sep } from 'node:path'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const capture = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()

// The 6 internal markers T-B02 is measured against. The allowlist already keeps them out; this is
// the belt to those braces, so a new allowlist line cannot quietly publish one. `paths` is what
// must not exist, `pattern` is what must not appear in any published file's text.
const MARKERS = [
  { name: 'TASKS.md', paths: ['TASKS.md'], pattern: /\bTASKS\.md\b/ },
  { name: 'OPERATOR_TODO.md', paths: ['OPERATOR_TODO.md'], pattern: /\bOPERATOR_TODO\.md\b/ },
  { name: 'FEASIBILITY.md', paths: ['FEASIBILITY.md'], pattern: /\bFEASIBILITY\.md\b/ },
  { name: 'OP-', paths: [], pattern: /\bOP-\d+\b/ },
  { name: '.claude', paths: ['.claude'], pattern: /(^|[^\w./-])\.claude\// },
  // The private repo. Judges clone the public one; a link back to dev is a dead end for them and
  // a map of the internal board for everyone else.
  { name: 'internal URL', paths: [], pattern: /github\.com\/[\w.-]+\/agon-dev\b/ },
]

// Internal by nature, never allowlisted, checked by path only.
const INTERNAL_PATHS = ['CLAUDE.md', 'spikes', 'docs/plans', '.env']

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.turbo'])

const walk = (dir, root = dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, root, out)
    else if (entry.isFile()) out.push(relative(root, full))
  }
  return out
}

const exists = (path) => {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

// Returns one line per survivor, empty when the tree is clean.
export const findInternalMarkers = (tree) => {
  const survivors = []

  for (const path of INTERNAL_PATHS) {
    if (exists(join(tree, path))) survivors.push(`${path} reached the public tree`)
  }

  const files = walk(tree)
  for (const marker of MARKERS) {
    for (const path of marker.paths) {
      if (exists(join(tree, path)))
        survivors.push(`${marker.name}: ${path} reached the public tree`)
    }
    if (!marker.pattern) continue
    for (const file of files) {
      let text
      try {
        text = readFileSync(join(tree, file), 'utf8')
      } catch {
        continue // binary or unreadable, nothing to match
      }
      const hit = text.split('\n').findIndex((line) => marker.pattern.test(line))
      if (hit !== -1) {
        survivors.push(`${marker.name}: ${file.split(sep).join('/')}:${hit + 1}`)
      }
    }
  }
  return survivors
}

const mode = ['--out', '--check', '--push'].find((flag) => process.argv.includes(flag))
const out = mode ? process.argv[process.argv.indexOf(mode) + 1] : undefined
if (!mode || !out || out.startsWith('--')) {
  console.error('usage: release.mjs --out <dir> | --check <dir> | --push <dir>')
  process.exit(1)
}

if (mode === '--out') {
  const patterns = readFileSync('.publicinclude', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  let copied = 0
  for (const pattern of patterns) {
    for (const src of globSync(pattern, {
      exclude: (p) => p.includes('node_modules') || p.includes('/dist/'),
    })) {
      const dest = join(out, src)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(src, dest, { recursive: true })
      copied++
    }
  }
  if (copied === 0) {
    console.error('release: the allowlist matched nothing. Refusing to publish an empty tree.')
    process.exit(1)
  }
  console.log(`release: copied ${copied} allowlisted path(s) into ${out}`)
  process.exit(0)
}

if (mode === '--check') {
  const survivors = findInternalMarkers(out)
  if (survivors.length > 0) {
    for (const survivor of survivors) console.error(`::error::${survivor}`)
    console.error(
      `release: ${survivors.length} internal marker(s) survived into ${out}. Nothing was published.`,
    )
    process.exit(1)
  }
  console.log(`release: 0 of ${MARKERS.length} internal markers survived into ${out}`)
  process.exit(0)
}

// --push: one release commit, authored by the person who tagged it, with a changelog.
// RELEASE_TAG is set by the daily schedule and by the rollback dispatch, which have no tag ref.
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || safeDescribe()
const token = process.env.PUBLIC_REPO_TOKEN
const repo = process.env.PUBLIC_REPO ?? 'agon-dev/agon'

function revParse(ref) {
  try {
    capture('git', ['rev-parse', '--verify', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function safeDescribe() {
  try {
    return capture('git', ['describe', '--tags', '--abbrev=0'])
  } catch {
    return ''
  }
}

// A scheduled run's GITHUB_REF_NAME is `dev`, not a tag. Publishing that would put a commit called
// "dev" on the public main and make the history unreadable, so the name is checked, not assumed.
if (!/^release-/.test(tag)) {
  console.error(`release: "${tag}" is not a release-* tag. Set RELEASE_TAG or tag the commit.`)
  process.exit(1)
}
if (!token) {
  console.error('release: PUBLIC_REPO_TOKEN is not set. See OP-7.')
  process.exit(1)
}

// Changelog from the commits since the previous release tag on dev.
const head = revParse(tag) ? tag : 'HEAD'
let since = ''
try {
  since = capture('git', ['describe', '--tags', '--abbrev=0', `${head}^`])
} catch {
  since = ''
}
const log = capture('git', [
  'log',
  '--no-merges',
  '--pretty=- %s',
  since ? `${since}..${head}` : head,
])
writeFileSync(join(out, 'CHANGELOG-latest.md'), `# ${tag}\n\n${log}\n`)

const clone = '/tmp/public-repo'
rmSync(clone, { recursive: true, force: true })
run('git', [
  'clone',
  '--depth',
  '1',
  `https://x-access-token:${token}@github.com/${repo}.git`,
  clone,
])

// Replace the tree wholesale: main is a projection of dev, not a branch with its own history of edits.
// readdirSync, not globSync: fs.globSync ignores `dot`, so a glob would leave .github and .gitignore
// behind in the public repo forever.
for (const entry of readdirSync(clone)) {
  if (entry === '.git') continue
  rmSync(join(clone, entry), { recursive: true, force: true })
}
cpSync(out, clone, { recursive: true })

const author = process.env.TAGGER ?? capture('git', ['log', '-1', '--pretty=%an'])
run('git', ['-C', clone, 'add', '-A'])
if (capture('git', ['-C', clone, 'status', '--porcelain']) === '') {
  console.log('release: the public tree is unchanged, nothing to push.')
  process.exit(0)
}
// No AI co-author lines. Work is credited to the person who ran the release.
run('git', [
  '-C',
  clone,
  '-c',
  `user.name=${author}`,
  '-c',
  'user.email=noreply@github.com',
  'commit',
  '-m',
  `${tag}\n\n${log}`,
])
run('git', ['-C', clone, 'tag', tag])
run('git', ['-C', clone, 'push', 'origin', 'HEAD:main', '--tags'])
console.log(`release: ${tag} pushed to ${repo} main`)
