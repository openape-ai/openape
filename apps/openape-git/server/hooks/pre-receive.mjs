#!/usr/bin/env node
// ape-git pre-receive hook — the identity binding (plan M4).
//
// The transport middleware authenticates the pusher (DDISA JWT) and passes
// the verified identity down via APE_GIT_* env; git inherits env through
// http-backend → receive-pack → this hook. Every NEW commit's committer email
// must belong to that identity: the actor itself or, for delegated agent
// pushes, its delegator. Only the committer is checked (not the author), only
// commits not yet reachable from any existing ref — so rebases and merges of
// foreign history pass. git:admin bypasses the check (mirror sync).
//
// Accepted pushes are recorded per commit in $GIT_DIR/ape-pushes.jsonl so the
// UI can show who pushed a commit (human/agent + delegation chain).
//
// Standalone plain-JS on purpose: installed by the app into
// <gitDataDir>/hooks at boot and executed by git, outside the Nuxt bundle.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import process from 'node:process'

const ZERO_SHA = /^0+$/

/** Pure decision, exported for tests: may these committer emails pass? */
export function rejectedCommits(commits, allowedEmails) {
  const allowed = new Set(allowedEmails.map(e => e.toLowerCase()))
  return commits.filter(c => !allowed.has(c.committerEmail.toLowerCase()))
}

/** Parse `git log --format=%H %cE` output into {sha, committerEmail}. */
export function parseCommitLines(out) {
  const commits = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const space = line.indexOf(' ')
    if (space === -1) continue
    commits.push({ sha: line.slice(0, space), committerEmail: line.slice(space + 1) })
  }
  return commits
}

function main() {
  const email = (process.env.APE_GIT_AUTH_EMAIL ?? '').trim()
  const act = process.env.APE_GIT_AUTH_ACT === 'human' ? 'human' : 'agent'
  const delegator = (process.env.APE_GIT_DELEGATOR ?? '').trim()
  const access = process.env.APE_GIT_ACCESS ?? ''

  // Fail closed: a receive-pack that did not come through the authenticated
  // transport has no business accepting pushes.
  if (!email) {
    process.stderr.write('ape-git: push rejected - no authenticated identity\n')
    process.exit(1)
  }

  // Second gate, independent of the transport. The middleware already checks
  // the grant, but it derives the required level from the request — and a
  // request can lie about what it is (the ?service= bypass did exactly that).
  // Reaching this hook is not proof that writing was allowed, so re-check the
  // level the transport actually resolved.
  if (access !== 'write' && access !== 'admin') {
    process.stderr.write(`ape-git: push rejected - grant is git:${access || 'none'}, push needs write\n`)
    process.exit(1)
  }

  const updates = []
  for (const line of readFileSync(0, 'utf8').split('\n')) {
    const [oldSha, newSha, ref] = line.split(' ')
    if (oldSha && newSha && ref && !ZERO_SHA.test(newSha)) updates.push(newSha)
  }

  // New commits = pushed objects not reachable from any existing ref. During
  // pre-receive the refs still point at their old targets, so --not --all
  // covers branch updates, new branches and force pushes alike.
  const seen = new Set()
  const newCommits = []
  for (const newSha of updates) {
    const out = execFileSync('git', ['log', '--format=%H %cE', newSha, '--not', '--all'], { encoding: 'utf8' })
    for (const commit of parseCommitLines(out)) {
      if (seen.has(commit.sha)) continue
      seen.add(commit.sha)
      newCommits.push(commit)
    }
  }

  if (access !== 'admin') {
    const allowed = [email, delegator].filter(Boolean)
    const rejected = rejectedCommits(newCommits, allowed)
    if (rejected.length > 0) {
      const first = rejected[0]
      process.stderr.write(
        `ape-git: push rejected - commit ${first.sha.slice(0, 7)} has committer `
        + `<${first.committerEmail}> but you are authenticated as <${allowed.join('> / <')}>. `
        + `Fix committer identity (git config user.email) or push with a git:admin grant.\n`,
      )
      process.exit(1)
    }
  }

  const log = newCommits.map(c => `${JSON.stringify({
    sha: c.sha,
    email,
    act,
    ...(delegator ? { delegator } : {}),
    ts: Math.floor(Date.now() / 1000),
  })}\n`).join('')
  if (log) appendFileSync(`${process.env.GIT_DIR ?? '.'}/ape-pushes.jsonl`, log)
  process.exit(0)
}

// Run only when invoked as the hook, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('pre-receive')) main()
