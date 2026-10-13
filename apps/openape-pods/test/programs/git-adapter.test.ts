// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'

// Golden values were derived from shapes-registry adapters/git/adapter.toml with
// the parser before declared options existed (issue 1468). With the extended
// adapter an argv keeps exactly that permission, or, when it carries an
// option the operation does not declare (`narrowed`), no longer matches. A
// `reclassified` argv keeps its permission under a more specific operation.
interface GoldenCase {
  argv: string[]
  expected: { operation_id: string, permission: string, display: string, exact_command: boolean }
  narrowed?: true
  reclassified?: { operation_id: string, display: string }
}

const adapterPath = join(import.meta.dirname, '../../examples/git-shapes.toml')
const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'git-adapter-golden.json'), 'utf8')) as GoldenCase[]

async function resolve(argv: string[]) {
  const resolved = await resolveCommand(loadAdapter('git', adapterPath), ['git', ...argv])
  return { operation_id: resolved.detail.operation_id, permission: resolved.permission, display: resolved.detail.display, exact_command: resolved.detail.constraints?.exact_command === true, bindings: resolved.bindings }
}

describe('extended git adapter', () => {
  it('narrows only argv with undeclared options and reclassifies only with the same permission', () => {
    expect(golden.filter(entry => !entry.narrowed).length).toBeGreaterThan(30)
    expect(golden.filter(entry => entry.narrowed).every(entry => entry.argv.some(token => token.startsWith('-')))).toBe(true)
  })

  it.each(golden.map(entry => [entry.argv.join(' '), entry] as const))('keeps or narrows the registry permission for git %s', async (_, entry) => {
    if (entry.narrowed) {
      await expect(resolve(entry.argv)).rejects.toThrow(/No adapter operation matched/)
      return
    }
    const { bindings: _bindings, ...detail } = await resolve(entry.argv)
    expect(detail).toEqual({ ...entry.expected, ...entry.reclassified })
  })

  const commandRunningOptions = [['--upload-pack=x'], ['--upload-pack', 'x'], ['-u', 'x'], ['--receive-pack=x'], ['--exec=x'], ['--exec', 'x'], ['-c', 'core.sshCommand=x'], ['--config', 'core.sshCommand=x'], ['-x', 'x'], ['--output=/tmp/x']]
  const commands = [['status'], ['log'], ['diff'], ['branch'], ['remote'], ['fetch'], ['fetch', 'origin'], ['pull'], ['add', 'file'], ['commit', '-m', 'msg'], ['push'], ['clone', 'https://example.test/r.git'], ['checkout', 'main'], ['switch', 'main'], ['merge', 'topic'], ['stash'], ['tag', 'v1'], ['worktree', 'list'], ['merge-base', 'A', 'B'], ['merge-tree', 'A', 'B'], ['rev-parse', 'HEAD'], ['rebase', 'origin/main'], ['push', 'origin', 'main'], ['replay', '--ref-action=print', '--onto', 'A', 'A..B']]
  const attempts = commands.flatMap(command => commandRunningOptions.flatMap(option => [
    [...command, ...option],
    [command[0]!, ...option, ...command.slice(1)],
    ['-C', '/work/repo', ...command, ...option],
  ]))

  it.each(attempts.map(argv => [argv.join(' '), argv] as const))('never lets git %s pass a non-exact operation', async (_, argv) => {
    const outcome = await resolve(argv).catch((error: Error) => error)
    if (outcome instanceof Error) {
      expect(outcome.message).toMatch(/No adapter operation matched/)
      return
    }
    expect(outcome.exact_command).toBe(true)
  })

  it('rejects a repeated -C, which git would combine into another path', async () => {
    await expect(resolve(['-C', '/work', '-C', 'repo', 'status'])).rejects.toThrow(/No adapter operation matched/)
    await expect(resolve(['-C', '/work', '-C', 'repo', 'push', 'origin', 'main'])).rejects.toThrow(/No adapter operation matched/)
  })

  it('reads worktrees, merge bases and merge trees of the repository given with -C', async () => {
    await expect(resolve(['-C', '/work/repo', 'worktree', 'list', '--porcelain'])).resolves.toMatchObject({ operation_id: 'git.worktree.list', permission: 'git.repo[*]#read', bindings: { repo: '/work/repo', porcelain: 'true' } })
    await expect(resolve(['-C', '/work/repo', 'merge-base', '--is-ancestor', 'A', 'B'])).resolves.toMatchObject({ operation_id: 'git.merge-base', bindings: { commit: 'A', other: 'B' } })
    await expect(resolve(['-C', '/work/repo', 'merge-tree', '--write-tree', 'main', 'feature'])).resolves.toMatchObject({ operation_id: 'git.merge-tree', permission: 'git.repo[*]#read' })
    await expect(resolve(['-C', '/work/repo', 'rev-parse', '--abbrev-ref', 'HEAD'])).resolves.toMatchObject({ operation_id: 'git.rev-parse', bindings: { ref: 'HEAD' } })
    await expect(resolve(['-C', '/work/repo', 'status', '--porcelain'])).resolves.toMatchObject({ operation_id: 'git.status', permission: 'git.repo[*]#read' })
    await expect(resolve(['-C', '/work/repo', 'fetch', 'origin'])).resolves.toMatchObject({ operation_id: 'git.fetch.remote', permission: 'git.repo[*].remote[*]#read' })
    // Issue 1468 follow-up: the IURIO rebase Pod replays a remote branch without a worktree. Only printed results are a read;
    // git's default and every other mode update refs and must never match it.
    await expect(resolve(['-C', '/work/repo', 'replay', '--ref-action=print', '--onto', 'origin/development', '--ref', 'refs/remotes/origin/feature', 'origin/development..origin/feature'])).resolves.toMatchObject({ operation_id: 'git.replay.print', permission: 'git.repo[*]#read', bindings: { range: 'origin/development..origin/feature', onto: 'origin/development' } })
    for (const argv of [['replay', '--onto', 'A', 'A..B'], ['replay', '--ref-action=update', '--onto', 'A', 'A..B'], ['replay', '--ref-action=print', '--ref-action=update', '--onto', 'A', 'A..B'], ['replay', '--ref-action=print', '--onto', 'A', '--ref-action', 'update', 'A..B'], ['replay', '--onto', 'A', '--ref-action=print', 'A..B']])
      await expect(resolve(['-C', '/work/repo', ...argv])).rejects.toThrow(/No adapter operation matched/)
  })

  it('binds rebase and push with a refspec to the exact command under their own actions', async () => {
    await expect(resolve(['-C', '/work/repo', 'rebase', 'origin/main'])).resolves.toMatchObject({ operation_id: 'git.rebase.upstream', permission: 'git.repo[*]#rebase', exact_command: true })
    await expect(resolve(['-C', '/work/repo', 'rebase', '--abort'])).resolves.toMatchObject({ operation_id: 'git.rebase', exact_command: true })
    await expect(resolve(['-C', '/work/repo', 'push', '--force-with-lease', 'origin', 'HEAD:refs/heads/topic'])).resolves.toMatchObject({ operation_id: 'git.push.refspec', permission: 'git.repo[*].remote[name=origin]#push', exact_command: true })
  })

  it('rejects other leading git options', async () => {
    await expect(resolve(['-c', 'core.sshCommand=touch /tmp/x', 'fetch', 'origin'])).rejects.toThrow(/No adapter operation matched/)
  })
})
