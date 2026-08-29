import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseCommitLines, rejectedCommits } from '../server/hooks/pre-receive.mjs'

// End-to-end: a real `git push` into a real bare repo running the real hook.
// Local pushes spawn receive-pack as a child of the pushing git, so the
// APE_GIT_* env we set here reaches the hook exactly like it does through
// `git http-backend` in production.

const ME = 'patrick@example.com'
const AGENT = 'agent@example.com'
const STRANGER = 'mallory@example.com'

let root: string
let bare: string
let work: string

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

function commit(message: string, committerEmail: string) {
  writeFileSync(join(work, `${message.replaceAll(/\W/g, '_')}.txt`), message)
  git(work, ['add', '.'])
  git(work, ['-c', `user.email=${committerEmail}`, '-c', 'user.name=Test', 'commit', '-m', message], {
    GIT_COMMITTER_EMAIL: committerEmail,
    GIT_COMMITTER_NAME: 'Test',
  })
}

function push(env: Record<string, string>, refspec = 'HEAD:refs/heads/main') {
  return git(work, ['push', bare, refspec], {
    APE_GIT_AUTH_EMAIL: '',
    APE_GIT_AUTH_ACT: '',
    APE_GIT_DELEGATOR: '',
    APE_GIT_ACCESS: '',
    ...env,
  })
}

function pushLog(): string {
  try {
    return readFileSync(join(bare, 'ape-pushes.jsonl'), 'utf8')
  }
  catch {
    return ''
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ape-git-hook-'))
  bare = join(root, 'repo.git')
  work = join(root, 'work')
  const hooks = join(root, 'hooks')
  git(root, ['init', '--bare', '-b', 'main', bare])
  mkdirSync(hooks)
  copyFileSync(join(__dirname, '../server/hooks/pre-receive.mjs'), join(hooks, 'pre-receive'))
  chmodSync(join(hooks, 'pre-receive'), 0o755)
  git(bare, ['config', 'core.hooksPath', hooks])
  mkdirSync(work)
  git(root, ['init', '-b', 'main', work])
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('pre-receive hook (real git push)', () => {
  it('accepts a push whose new commits are committed by the authenticated identity, and logs it', () => {
    commit('mine', ME)
    push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: 'write' })
    const lines = pushLog().trim().split('\n')
    expect(lines).toHaveLength(1)
    const rec = JSON.parse(lines[0]!)
    expect(rec.email).toBe(ME)
    expect(rec.act).toBe('human')
    expect(rec.delegator).toBeUndefined()
  })

  it('rejects a push containing a foreign committer, quoting the emails', () => {
    commit('theirs', STRANGER)
    expect(() => push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: 'write' }))
      .toThrow(/push rejected.*mallory@example\.com.*patrick@example\.com/s)
    // undo the offending commit for the following tests
    git(work, ['reset', '--hard', 'HEAD~1'])
  })

  it('rejects when no authenticated identity reached the hook', () => {
    commit('unauthed', ME)
    expect(() => push({})).toThrow(/no authenticated identity/)
    git(work, ['reset', '--hard', 'HEAD~1'])
  })

  it('rejects a push that only carries read access', () => {
    // The transport gate can be tricked into asking for the wrong level (that
    // was the ?service= bypass), so the hook must not treat "it got here" as
    // proof that writing was allowed.
    commit('read-attempt', ME)
    expect(() => push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: 'read' }))
      .toThrow(/git:read.*needs write/s)
    git(work, ['reset', '--hard', 'HEAD~1'])
  })

  it('rejects a push that carries no access level at all', () => {
    commit('blank-access', ME)
    expect(() => push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: '' }))
      .toThrow(/needs write/)
    git(work, ['reset', '--hard', 'HEAD~1'])
  })

  it('lets an agent push commits committed by its delegator, recording the chain', () => {
    commit('made by the human, pushed by the agent', ME)
    push({ APE_GIT_AUTH_EMAIL: AGENT, APE_GIT_AUTH_ACT: 'agent', APE_GIT_DELEGATOR: ME, APE_GIT_ACCESS: 'write' })
    const last = JSON.parse(pushLog().trim().split('\n').at(-1)!)
    expect(last.email).toBe(AGENT)
    expect(last.act).toBe('agent')
    expect(last.delegator).toBe(ME)
  })

  it('git:admin bypasses the committer check (mirror sync)', () => {
    commit('foreign history', STRANGER)
    push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: 'admin' })
    const last = JSON.parse(pushLog().trim().split('\n').at(-1)!)
    expect(last.email).toBe(ME)
  })

  it('checks only NEW commits - existing foreign history does not block a push', () => {
    // The foreign commit from the admin push is now reachable from main;
    // pushing a new branch containing it plus one own commit must pass.
    commit('own on top of foreign', ME)
    push({ APE_GIT_AUTH_EMAIL: ME, APE_GIT_AUTH_ACT: 'human', APE_GIT_ACCESS: 'write' }, 'HEAD:refs/heads/feature')
  })
})

describe('hook pure logic', () => {
  it('parseCommitLines splits sha and committer email', () => {
    expect(parseCommitLines('abc patrick@example.com\ndef mallory@example.com\n')).toEqual([
      { sha: 'abc', committerEmail: 'patrick@example.com' },
      { sha: 'def', committerEmail: 'mallory@example.com' },
    ])
  })

  it('rejectedCommits is case-insensitive on emails', () => {
    const commits = [{ sha: 'a', committerEmail: 'Patrick@Example.com' }]
    expect(rejectedCommits(commits, ['patrick@example.com'])).toEqual([])
    expect(rejectedCommits(commits, ['other@example.com'])).toHaveLength(1)
  })
})
