import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { owner, startIssueFixture } from './fixture'

let fixture: Awaited<ReturnType<typeof startIssueFixture>>
let user: Awaited<ReturnType<typeof fixture.identity>>
let stranger: typeof user
let bodyFile: string
beforeAll(async () => {
  fixture = await startIssueFixture()
  bodyFile = join(fixture.directory, 'body.md')
  writeFileSync(bodyFile, 'Confirmed through the CLI')
  user = await fixture.identity(owner)
  stranger = await fixture.identity('stranger@issues.test')
  expect((await user.call('POST', '/api/repos', { owner: 'owner', name: 'project' })).status).toBe(200)
})
afterAll(async () => { await fixture?.stop() })

describe('real DDISA login, native API and CLI', () => {
  it('exchanges a real IdP token, creates once, comments and closes through the CLI', async () => {
    const created = await user.cli('create', '--repo', 'owner/project', '--title', 'Signed CLI issue', '--body-file', bodyFile, '--idempotency-key', 'cli-roundtrip-001')
    const retry = await user.cli('create', '--repo', 'owner/project', '--title', 'Signed CLI issue', '--body-file', bodyFile, '--idempotency-key', 'cli-roundtrip-001')
    expect(retry.id).toBe(created.id)
    const body = await user.cli('comment', '--id', created.id, '--body-file', bodyFile, '--idempotency-key', 'cli-comment-001')
    expect(body.anchor).toBe(`#comment-${body.id}`)
    const comments = await user.cli('comments', '--id', created.id)
    expect(comments.comments[0].body).toBe('Confirmed through the CLI')
    const closed = await user.cli('close', '--id', created.id, '--expected-version', '1')
    expect(closed.state).toBe('closed')
    const reopened = await user.call('PATCH', `/api/issue-records/${created.id}`, { state: 'open', expectedVersion: closed.version })
    expect(reopened.status).toBe(200)
    expect((await user.session.getJSON<{ title: string }>(`${fixture.base}/api/issue-records/${created.id}`)).data.title).toBe('Signed CLI issue')
    expect((await stranger.call('GET', `/api/issue-records/${created.id}`)).status).toBe(404)
    expect(await (await stranger.call('GET', '/api/issues')).json()).toMatchObject({ total: 0, issues: [] })
    expect(await (await stranger.call('GET', '/api/issue-facets')).json()).toMatchObject({ repositories: [], labels: [], products: [], assignees: [] })
    const anonymous = await fetch(`${fixture.base}/api/issue-records/${created.id}`)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.text()).not.toContain('Signed CLI issue')
  })
  it('rejects cross-site session writes and stale versions without overwriting text', async () => {
    const created = await user.cli('create', '--repo', 'owner/project', '--title', 'Versioned', '--body-file', bodyFile, '--idempotency-key', 'cli-versioned-001')
    const attack = await user.session.fetch(`${fixture.base}/api/issue-records/${created.id}`, { method: 'PATCH', headers: { origin: 'https://attacker.test', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Bad', expectedVersion: 1 }) })
    expect(attack.status).toBe(403)
    const legitimate = await user.session.fetch(`${fixture.base}/api/issue-records/${created.id}`, { method: 'PATCH', headers: { origin: fixture.base, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Updated', expectedVersion: 1 }) })
    expect(legitimate.status).toBe(200)
    expect((await user.call('PATCH', `/api/issue-records/${created.id}`, { title: 'Lost update', expectedVersion: 1 })).status).toBe(409)
  })
})
