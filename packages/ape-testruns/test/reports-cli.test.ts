import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCliHarness } from '../../proof-cli/test/cli-harness'

const cli = createCliHarness(join(import.meta.dirname, '..'), 'dist/reports.mjs')
const examples = join(import.meta.dirname, '../examples')
afterAll(() => cli.dispose())
describe('ape-reports executable contract', () => {
  it('ships every approved command and locally renders every subcommand help', () => {
    const root = cli.run('--help'); expect(root.status).toBe(0)
    for (const command of ['whoami', 'preview', 'publish', 'update', 'list', 'show', 'history', 'open', 'export', 'receipt', 'categories', 'tags', 'teams', 'access', 'retention', 'rm', 'restore', 'docs']) {
      expect(root.stdout).toContain(command)
      const result = cli.run(command, '--help'); expect(result.status).toBe(0); expect(result.stdout).toContain(`USAGE  ape-reports ${command}`)
    }
  })
  it('exposes native team operations and rejects malformed changes before authentication', () => {
    for (const command of ['create', 'show', 'members', 'update', 'invite', 'invites', 'accept', 'revoke-invite', 'remove-member', 'archive', 'unarchive', 'rm']) {
      const result = cli.run('teams', command, '--help')
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`USAGE  ape-reports teams ${command}`)
    }
    expect(cli.run('teams', 'invite', 'team', '--max-uses', '0').status).toBe(2)
    expect(cli.run('teams', 'update', 'team').status).toBe(2)
    expect(cli.run('teams', 'accept', 'https://example.test/no-token').status).toBe(2)
    expect(cli.run('teams', 'remove-member', 'team').status).toBe(2)
  })
  it('previews all complete examples without authentication or a companion file', () => {
    for (const example of ['analysis', 'testrun', 'plan']) {
      const result = cli.run('preview', join(examples, `${example}.html`), '--json')
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ valid: true, tags: ['reports', 'consolidation'], external_images: [] })
    }
  })
  it('applies explicit metadata precedence and reports local errors before authentication', () => {
    const preview = cli.run('preview', join(examples, 'analysis.html'), '--title', 'Override', '--tag', '  DELIVERY  ', '--clear-category', '--meta', 'example.kind=updated', '--json')
    expect(preview.status, preview.stderr).toBe(0)
    expect(JSON.parse(preview.stdout)).toMatchObject({ title: 'Override', tags: ['delivery'], metadata: { 'example.kind': 'updated' } })
    expect(JSON.parse(preview.stdout)).not.toHaveProperty('category')
    const invalid = cli.run('publish', '/missing/report.html', '--key', 'test', '--json')
    expect(invalid.status).toBe(2); expect(invalid.stdout).toBe(''); expect(JSON.parse(invalid.stderr).error.code).toBe('VALIDATION')
    expect(cli.run('restore', 'id', '--forever').status).toBe(2)
    expect(cli.run('update', 'id', '--title', 'Changed', '--key', 'update').status).toBe(2)
    const unauthenticated = cli.run('list', '--endpoint', 'http://127.0.0.1:9', '--json')
    expect(unauthenticated.status).toBe(3); expect(unauthenticated.stdout).toBe('')
  })
})
