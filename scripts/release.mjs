#!/usr/bin/env node
// dev -> the public main, by the .publicinclude allowlist.
//
//   node scripts/release.mjs --out /tmp/public    copy the allowlisted paths into a clean tree
//   node scripts/release.mjs --push /tmp/public   push that tree as one release commit
//
// An allowlist, not a denylist, so a new internal file stays private by default.

import {
  cpSync,
  globSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const capture = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()

const patterns = readFileSync('.publicinclude', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

const out =
  process.argv[process.argv.indexOf('--out') + 1] ??
  process.argv[process.argv.indexOf('--push') + 1]
if (!out || out.startsWith('--')) {
  console.error('usage: release.mjs --out <dir> | --push <dir>')
  process.exit(1)
}

if (process.argv.includes('--out')) {
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

// --push: one release commit, authored by the person who tagged it, with a changelog.
const tag = process.env.GITHUB_REF_NAME ?? capture('git', ['describe', '--tags', '--abbrev=0'])
const token = process.env.PUBLIC_REPO_TOKEN
const repo = process.env.PUBLIC_REPO ?? 'agon-dev/agon'
if (!token) {
  console.error('release: PUBLIC_REPO_TOKEN is not set. See OP-7.')
  process.exit(1)
}

// Changelog from the commits since the previous release tag on dev.
let since = ''
try {
  since = capture('git', ['describe', '--tags', '--abbrev=0', `${tag}^`])
} catch {
  since = ''
}
const log = capture('git', [
  'log',
  '--no-merges',
  '--pretty=- %s',
  since ? `${since}..${tag}` : tag,
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
