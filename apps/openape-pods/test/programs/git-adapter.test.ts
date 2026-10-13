// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'

// Golden values were derived from shapes-registry adapters/git/adapter.toml with
// the parser before declared options existed (issue 1468). Grants approved for
// those argv must keep their exact permission with the extended adapter.
interface GoldenCase {
  argv: string[]
  expected: { operation_id: string, permission: string, display: string, exact_command: boolean }
}

const adapterPath = join(import.meta.dirname, '../../examples/git-shapes.toml')
const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'git-adapter-golden.json'), 'utf8')) as GoldenCase[]

async function resolve(argv: string[]) {
  const resolved = await resolveCommand(loadAdapter('git', adapterPath), ['git', ...argv])
  return { operation_id: resolved.detail.operation_id, permission: resolved.permission, display: resolved.detail.display, exact_command: resolved.detail.constraints?.exact_command === true, bindings: resolved.bindings }
}

describe('extended git adapter', () => {
  it.each(golden.map(entry => [entry.argv.join(' '), entry] as const))('keeps the registry permission for git %s', async (_, entry) => {
    const { bindings: _bindings, ...detail } = await resolve(entry.argv)
    expect(detail).toEqual(entry.expected)
  })

  it('reads worktrees, merge bases and merge trees of the repository given with -C', async () => {
    await expect(resolve(['-C', '/work/repo', 'worktree', 'list', '--porcelain'])).resolves.toMatchObject({ operation_id: 'git.worktree.list', permission: 'git.repo[*]#read', bindings: { repo: '/work/repo', porcelain: 'true' } })
    await expect(resolve(['-C', '/work/repo', 'merge-base', '--is-ancestor', 'A', 'B'])).resolves.toMatchObject({ operation_id: 'git.merge-base', bindings: { commit: 'A', other: 'B' } })
    await expect(resolve(['-C', '/work/repo', 'merge-tree', '--write-tree', 'main', 'feature'])).resolves.toMatchObject({ operation_id: 'git.merge-tree', permission: 'git.repo[*]#read' })
    await expect(resolve(['-C', '/work/repo', 'rev-parse', '--abbrev-ref', 'HEAD'])).resolves.toMatchObject({ operation_id: 'git.rev-parse', bindings: { ref: 'HEAD' } })
    await expect(resolve(['-C', '/work/repo', 'status', '--porcelain'])).resolves.toMatchObject({ operation_id: 'git.status', permission: 'git.repo[*]#read' })
    await expect(resolve(['-C', '/work/repo', 'fetch', 'origin'])).resolves.toMatchObject({ operation_id: 'git.fetch.remote', permission: 'git.repo[*].remote[*]#read' })
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
