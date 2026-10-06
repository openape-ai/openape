import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const forge = 'openape-issues-m0-forgejo'
const runner = 'openape-issues-m0-runner'
const forgeImage = 'codeberg.org/forgejo/forgejo@sha256:eda2e378442d2f18cfa563994f8ad66e71f04ac9c3bb4259cc57bdd641890f5c'
const runnerImage = 'data.forgejo.org/forgejo/runner@sha256:c4af85fd9f0dd03788676a534781a87c71aa2c6a37737143e017eb94d4312952'
const output = resolve('.openape/native-issues-m0/fixture')
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const [operation, ...extra] = process.argv.slice(2)
assert.ok(['up', 'down'].includes(operation) && !extra.length, 'Usage: node scripts/native-issues/fixture.mjs up|down')
const existing = docker(['ps', '-a', '--format', '{{.Names}}']).split('\n')

if (operation === 'down') {
  for (const name of [runner, forge]) {
    if (!existing.includes(name)) continue
    assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "openape.task"}}', name]), 'issue-1356')
    docker(['rm', '-f', '-v', name])
  }
  console.log('Removed only issue-1356 fixture containers; local evidence retained.')
}
else {
  assert.ok(!existing.includes(forge) && !existing.includes(runner), 'Fixture containers already exist; inspect them before cleanup')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const secret = (name, value) => writeFileSync(`${output}/${name}`, value, { mode: 0o600, flag: 'wx' })
  const password = randomBytes(24).toString('base64url')
  secret('password', password)
  docker(['run', '-d', '--name', forge, '--label', 'openape.task=issue-1356', '-p', '127.0.0.1:13856:3000',
    '-e', 'FORGEJO__security__INSTALL_LOCK=true', '-e', 'FORGEJO__database__DB_TYPE=sqlite3',
    '-e', 'FORGEJO__server__ROOT_URL=http://127.0.0.1:13856/', '-e', 'FORGEJO__service__DISABLE_REGISTRATION=true',
    '-e', 'FORGEJO__actions__ENABLED=true', '-e', 'FORGEJO__mailer__ENABLED=false', '-e', 'FORGEJO__server__DISABLE_SSH=true', forgeImage])
  const endpoint = 'http://127.0.0.1:13856/api/v1'
  const deadline = Date.now() + 30000
  let ready = false
  while (Date.now() < deadline) {
    try { ready = (await fetch(`${endpoint}/version`, { signal: AbortSignal.timeout(1000) })).ok }
    catch (error) {
      if (!['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(error.cause?.code) && error.name !== 'TimeoutError') throw error
    }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Fixture did not start; inspect its container logs')
  docker(['exec', '--user', 'git', forge, 'forgejo', 'admin', 'user', 'create', '--username', 'pilot', '--email', 'pilot@example.test', '--password', password, '--admin', '--must-change-password=false'])
  const token = docker(['exec', '--user', 'git', forge, 'forgejo', 'admin', 'user', 'generate-access-token', '--username', 'pilot', '--token-name', 'm0-fixture', '--scopes', 'all', '--raw']).split('\n').at(-1)
  secret('token', token)
  const create = async (path, body) => {
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 201, `Fixture creation failed: ${path}`)
    return response.json()
  }
  await create('/user/repos', { name: 'pilot', auto_init: true, default_branch: 'main', private: true })
  const issue = await create('/repos/pilot/pilot/issues', { title: 'Fixture issue', body: 'Disposable M0 rehearsal' })
  const comment = await create('/repos/pilot/pilot/issues/1/comments', { body: 'Legacy comment anchor fixture' })
  writeFileSync(`${output}/seed.json`, JSON.stringify({ issue: issue.id, comment: comment.id, commentUrl: comment.html_url }, null, 2))
  const registration = docker(['exec', '--user', 'git', forge, 'forgejo', 'actions', 'generate-runner-token', '--scope', 'pilot/pilot']).split('\n').at(-1)
  secret('runner-token', registration)
  docker(['run', '-d', '--name', runner, '--label', 'openape.task=issue-1356', '--network', `container:${forge}`, '--user', '0', '--entrypoint', 'sh', runnerImage, '-c', 'sleep 3600'])
  docker(['cp', `${output}/runner-token`, `${runner}:/tmp/registration-token`])
  docker(['exec', runner, 'sh', '-c', 'forgejo-runner register --no-interactive --instance http://127.0.0.1:3000 --name m0-isolated --labels m0:host --token "$(cat /tmp/registration-token)" >/tmp/register.log 2>&1 && rm /tmp/registration-token'])
  docker(['exec', '-d', runner, 'sh', '-c', 'forgejo-runner daemon >/tmp/daemon.log 2>&1'])
  console.log('Private disposable Forgejo 15.0.5 is ready at http://127.0.0.1:13856; credentials remain in the ignored fixture directory.')
}
