import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const container = 'openape-issues-m0-forgejo'
let endpoint = 'http://127.0.0.1:13856'
const proxyEnabled = process.env.OPENAPE_ISSUE_ARCHIVE_PROXY === '1'
let proxy
const output = resolve('.openape/native-issues-m0/fixture')
const token = readFileSync(`${output}/token`, 'utf8').trim()
const evidence = []

function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'sqlite3', '/data/gitea/gitea.db'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
async function request(path, method = 'GET', body) {
  const response = await fetch(`${endpoint}/api/v1${path}`, {
    method, headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}
function checkpoint(name, details) { evidence.push({ name, ...details }); console.log(name, JSON.stringify(details)) }

assert.equal((await request('/version')).data.version, '15.0.5+gitea-1.22.0')
assert.equal((await request('/repos/pilot/pilot')).data.id, 1)
const seed = JSON.parse(readFileSync(`${output}/seed.json`, 'utf8'))
assert.equal(seed.issue, 1)
const before = sql('SELECT id,content,is_closed,num_comments FROM issue WHERE id=1; SELECT id,content FROM comment WHERE issue_id=1 ORDER BY id;')
const sourceHash = createHash('sha256').update(before).digest('hex')

const issueMatch = alias => `${alias}.repo_id=1 AND ${alias}.is_pull=0`
const childMatch = alias => `${alias}.issue_id IN (SELECT id FROM issue WHERE repo_id=1 AND is_pull=0)`
const predicates = {
  issue: issueMatch,
  comment: childMatch,
  issue_assignees: childMatch,
  issue_label: childMatch,
  issue_content_history: childMatch,
  project_issue: childMatch,
  reaction: childMatch,
  stopwatch: childMatch,
  tracked_time: childMatch,
  issue_dependency: alias => `(${childMatch(alias)}) OR ${alias}.dependency_id IN (SELECT id FROM issue WHERE repo_id=1 AND is_pull=0)`,
  label: alias => `${alias}.repo_id=1`,
  attachment: alias => `(${childMatch(alias)}) OR ${alias}.comment_id IN (SELECT id FROM comment WHERE issue_id IN (SELECT id FROM issue WHERE repo_id=1 AND is_pull=0))`,
}
const triggers = []
for (const [table, predicate] of Object.entries(predicates)) {
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const matches = operation === 'UPDATE' ? `(${predicate('OLD')}) OR (${predicate('NEW')})` : predicate(operation === 'DELETE' ? 'OLD' : 'NEW')
    triggers.push(`CREATE TRIGGER m0_freeze_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN ${matches} BEGIN SELECT RAISE(ABORT, 'M0 issue archive is read-only'); END;`)
  }
}
const cleanup = Object.keys(predicates).flatMap(table => ['insert', 'update', 'delete'].map(operation => `DROP TRIGGER IF EXISTS m0_freeze_${table}_${operation};`)).join('\n')
writeFileSync(`${output}/fence.sql`, `BEGIN;\n${triggers.join('\n')}\nCOMMIT;\n`)
try {
  if (proxyEnabled) {
    proxy = spawn(process.execPath, ['scripts/native-issues/archive-proxy-fixture.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Archive proxy did not start')), 10000)
      proxy.once('error', (error) => { clearTimeout(timer); reject(error) })
      proxy.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Archive proxy exited: ${code}`)) })
      proxy.stdout.once('data', () => { clearTimeout(timer); resolveReady() })
    })
    endpoint = 'http://127.0.0.1:13857'
  }
  sql(readFileSync(`${output}/fence.sql`, 'utf8'))
  for (const [name, path, method, body] of [
    ['issue-create', '/repos/pilot/pilot/issues', 'POST', { title: 'Must be rejected' }],
    ['comment-create', '/repos/pilot/pilot/issues/1/comments', 'POST', { body: 'Must be rejected' }],
    ['issue-close', '/repos/pilot/pilot/issues/1', 'PATCH', { state: 'closed' }],
    ['issue-edit', '/repos/pilot/pilot/issues/1', 'PATCH', { body: 'Must be rejected' }],
    ['comment-edit', '/repos/pilot/pilot/issues/comments/1', 'PATCH', { body: 'Must be rejected' }],
    ['label-create', '/repos/pilot/pilot/labels', 'POST', { name: 'blocked', color: 'ff0000' }],
  ]) {
    const result = await request(path, method, body)
    assert.equal(result.status, proxyEnabled ? 503 : 500, `${name} did not reach the expected database denial`)
    checkpoint(name, { status: result.status })
  }
  if (proxyEnabled) {
    for (const [path, method] of [['/repos/pilot/pilot', 'DELETE'], ['/repos/pilot/pilot/transfer', 'POST'], ['/admin/users/pilot', 'DELETE'], ['/repos/pilot/pilot/issues/1/assets/1', 'DELETE']]) {
      const result = await request(path, method)
      assert.equal(result.status, 503)
      checkpoint('administrative-write-fence', { path, status: result.status })
    }
    const upload = await fetch(`${endpoint}/attachments`, { method: 'POST', body: 'synthetic' })
    assert.equal(upload.status, 503)
    checkpoint('standalone-upload-fence', { status: upload.status })
  }
  const read = await request('/repos/pilot/pilot/issues/1')
  assert.equal(read.status, 200)
  checkpoint('issue-read', { status: read.status, state: read.data.state })

  const gitDirectory = `${output}/git`
  mkdirSync(gitDirectory, { recursive: true })
  const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`pilot:${token}`).toString('base64')}` }
  const git = args => execFileSync('git', args, { cwd: gitDirectory, env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-b', 'main'])
  git(['fetch', `${endpoint}/pilot/pilot.git`, 'main'])
  git(['checkout', '-B', 'm0-ci-proof', 'FETCH_HEAD'])
  writeFileSync(`${gitDirectory}/fence-proof.txt`, 'Disposable M0 Git push proof\n')
  mkdirSync(`${gitDirectory}/.forgejo/workflows`, { recursive: true })
  writeFileSync(`${gitDirectory}/.forgejo/workflows/m0-proof.yml`, 'name: M0 fence proof\non: [push]\njobs:\n  proof:\n    runs-on: m0\n    steps:\n      - run: test 1 = 1\n')
  git(['add', 'fence-proof.txt', '.forgejo/workflows/m0-proof.yml'])
  git(['-c', 'user.name=M0 Fixture', '-c', 'user.email=m0@example.test', 'commit', '--allow-empty', '-m', 'test: preserve Git while issues are frozen; closes #1'])
  const sha = git(['rev-parse', 'HEAD'])
  git(['push', `${endpoint}/pilot/pilot.git`, 'HEAD:refs/heads/m0-ci-proof'])
  git(['push', `${endpoint}/pilot/pilot.git`, 'HEAD:refs/heads/main'])
  assert.ok(git(['ls-remote', `${endpoint}/pilot/pilot.git`, 'refs/heads/m0-ci-proof']).startsWith(sha))
  checkpoint('branch-and-main-push', { sha, success: true })
  const status = await request(`/repos/pilot/pilot/statuses/${sha}`, 'POST', { state: 'success', context: 'm0/transport-proof', description: 'Fixture verifies status publication; not a complete Actions run' })
  assert.equal(status.status, 201)
  const combined = await request(`/repos/pilot/pilot/commits/${sha}/status`)
  assert.equal(combined.data.state, 'success')
  checkpoint('ci-status-roundtrip', { status: status.status, state: combined.data.state })
  const deadline = Date.now() + 60000
  let completedRun
  while (Date.now() < deadline) {
    const runs = await request('/repos/pilot/pilot/actions/runs')
    assert.equal(runs.status, 200)
    const run = runs.data.workflow_runs.find(run => run.commit_sha === sha && run.prettyref === 'main' && ['success', 'failure', 'cancelled'].includes(run.status))
    if (run) { completedRun = run; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(completedRun, 'Actions did not complete while the fence was installed')
  assert.equal(completedRun.status, 'success')
  checkpoint('actions-run', { id: completedRun.id, headSha: completedRun.commit_sha, conclusion: completedRun.status })
  const after = sql('SELECT id,content,is_closed,num_comments FROM issue WHERE id=1; SELECT id,content FROM comment WHERE issue_id=1 ORDER BY id;')
  assert.equal(after, before)
  checkpoint('frozen-content', { beforeSha256: sourceHash, afterSha256: createHash('sha256').update(after).digest('hex') })
}
finally {
  proxy?.kill('SIGTERM')
  endpoint = 'http://127.0.0.1:13856'
  sql(`BEGIN;\n${cleanup}\nCOMMIT;`)
  writeFileSync(`${output}/fence-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`)
}
const restored = await request('/repos/pilot/pilot/issues/1/comments', 'POST', { body: 'Writes restored after removing disposable fence' })
assert.equal(restored.status, 201)
checkpoint('rollback-restores-comments', { status: restored.status })
writeFileSync(`${output}/fence-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`)
