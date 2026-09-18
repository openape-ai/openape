import { existsSync, writeFileSync } from 'node:fs'
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
  it('reports and triages through real exchanged CLI credentials without granting code access', async () => {
    await user.cli('policy', 'set', '--repo', 'owner/project', '--enabled', 'true', '--expected-version', '1')
    await user.cli('product', 'set', '--repo', 'owner/project', '--product', 'plans', '--name', 'Plans', '--enabled', 'true', '--expected-version', '0')
    const catalog = await stranger.cli('product', 'list', '--product', 'unknown')
    const report = await stranger.cli('report', 'create', '--product', 'unknown', '--routing-version', catalog.selected.routingVersion, '--title', 'Product report from outsider', '--body-file', bodyFile, '--idempotency-key', 'real-report-001')
    expect(report.capabilities.repository).toBeNull()
    const mapping = join(fixture.directory, 'labels.json')
    writeFileSync(mapping, '{}')
    const moved = await user.cli('transfer', '--id', report.id, '--product', 'plans', '--label-map-file', mapping, '--expected-version', '1')
    expect(moved.id).toBe(report.id)
    expect(moved.productName).toBe('Plans')
    await stranger.cli('comment', '--id', report.id, '--body-file', bodyFile, '--idempotency-key', 'real-report-comment-001')
    expect((await stranger.call('GET', '/api/repos/owner/project/issues')).status).toBe(404)
    await user.cli('moderate', '--id', report.id, '--revoke-participant', 'stranger@issues.test', '--reason', 'Fixture revocation', '--expected-version', '2')
    expect((await stranger.call('GET', `/api/issue-records/${report.id}`)).status).toBe(404)
  })

  it('links through the CLI and keeps the issue open after a real exact-SHA PR merge', async () => {
    const heads = await fixture.seedBranches('owner', 'project')
    const pull = await (await user.call('POST', '/api/repos/owner/project/pulls', { title: 'Related implementation', source: 'fix-issue', target: 'main' })).json()
    const issue = await user.cli('create', '--repo', 'owner/project', '--title', 'Resolve explicitly', '--body-file', bodyFile, '--idempotency-key', 'link-roundtrip-001')
    for (let n = 0; n < 2; n++) await user.cli('link', '--id', issue.id, '--pull-repo', 'owner/project', '--pull-number', String(pull.number))
    const relations = await user.cli('links', '--id', issue.id)
    expect(relations.pulls).toHaveLength(1)
    const merged = await user.call('POST', `/api/repos/owner/project/pulls/${pull.number}/merge`, { expectedSourceSha: heads.sourceSha, expectedTargetSha: heads.targetSha })
    expect(merged.status).toBe(200)
    expect((await user.cli('links', '--id', issue.id)).pulls[0].state).toBe('merged')
    expect((await user.cli('show', '--id', issue.id)).state).toBe('open')
    expect((await (await user.call('GET', `/api/repos/owner/project/pulls/${pull.number}/issues`)).json()).issues[0].id).toBe(issue.id)
    await user.cli('unlink', '--id', issue.id, '--pull-id', relations.pulls[0].id)
    expect((await user.cli('links', '--id', issue.id)).pulls).toEqual([])
  })
  it('registers an issue-only home without Git storage, code writes or mirror configuration', async () => {
    const endpoint = '/api/repos/owner/external'
    const created = await user.call('POST', '/api/repos', { owner: 'owner', name: 'external', issueHomeOnly: true, codeSourceUrl: 'https://code.example/owner/external' })
    expect(created.status).toBe(200)
    expect(existsSync(join(fixture.directory, 'repos/owner/external.git'))).toBe(false)
    const metadata = await (await user.call('GET', `${endpoint}/metadata`)).json()
    expect(metadata).toEqual({ owner: 'owner', name: 'external', issueHomeOnly: 1, codeSourceUrl: 'https://code.example/owner/external' })
    expect((await stranger.call('GET', `${endpoint}/metadata`)).status).toBe(404)
    const issue = await user.cli('create', '--repo', 'owner/external', '--title', 'External code issue', '--body-file', bodyFile, '--idempotency-key', 'external-issue-001')
    expect(issue.repositoryUrl).toBe('/owner/external/issues/1')
    for (const [method, path, body] of [
      ['GET', '/browse', undefined], ['GET', '/pulls', undefined],
      ['POST', '/pulls', { title: 'No native code', source: 'feature', target: 'main' }],
      ['POST', '/mirrors', { url: 'https://code.example/mirror', username: 'fixture', token: 'fixture' }],
      ['POST', '/mirrors/reconcile', {}], ['POST', '/protections', {}], ['POST', '/webhooks', {}],
    ] as const) expect((await user.call(method, `${endpoint}${path}`, body)).status).toBe(409)
    const git = (name: string) => fetch(`${fixture.base}/owner/${name}.git/info/refs?service=git-upload-pack`, { headers: { authorization: `Basic ${Buffer.from(`x-access-token:${user.idpToken}`).toString('base64')}` } })
    expect((await git('project')).status).toBe(200)
    expect((await git('external')).status).toBe(409)
    expect((await user.call('POST', '/api/repos', { owner: 'owner', name: 'project', issueHomeOnly: true, codeSourceUrl: 'https://code.example/source' })).status).toBe(409)
    expect((await user.call('GET', '/api/repos/owner/project/metadata')).status).toBe(200)
    for (const codeSourceUrl of ['javascript:alert(1)', 'https://user:secret@code.example/repo', 'https://code.example/repo?token=secret']) {
      expect((await user.call('POST', '/api/repos', { owner: 'owner', name: 'invalid', issueHomeOnly: true, codeSourceUrl })).status).toBe(400)
    }
  })

})
