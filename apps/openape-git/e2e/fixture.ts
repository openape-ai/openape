import type { RunningServer } from 'openape-e2e/lifecycle'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createClient } from '@libsql/client'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { HttpClient } from '../../../examples/e2e/helpers/http-client'

const run = promisify(execFile)
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(appRoot, '../..')
const managementToken = 'native-issues-disposable-fixture-management'
export const owner = 'owner@issues.test'

export async function startIssueFixture() {
  const directory = makeTempDir('native-issues-e2e-')
  const idp = await startIdp({ managementToken, ddisaMockRecords: { 'issues.test': { version: 'ddisa1', idp: 'https://idp.issues.test', mode: 'open' } } })
  let app: RunningServer | undefined
  try {
    app = await startServer({
      cwd: appRoot,
      readyPath: '/api/health',
      timeoutMs: 300000,
      env: ({ url }) => ({
        NUXT_IGNORE_LOCK: '1',
        NUXT_TURSO_URL: `file:${directory}/registry.db`,
        NUXT_GIT_DATA_DIR: directory,
        NUXT_PUBLIC_ISSUES_ENABLED: 'true',
        NUXT_ISSUE_INTAKE_REPO_ID: 'fixture-intake',
        NUXT_ISSUE_ROUTING_ADMIN: owner,
        NUXT_OPENAPE_CLIENT_ID: new URL(url).host,
        NUXT_OPENAPE_SP_SESSION_SECRET: 'native-issues-e2e-session-secret-at-least-32-characters',
        NUXT_FALLBACK_IDP_URL: idp.url,
        NUXT_IDP_URL: idp.url,
        OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
        DDISA_MOCK_RECORDS: JSON.stringify({ 'issues.test': { version: 'ddisa1', idp: idp.url, mode: 'open' } }),
      }),
    })
    const base = app.url
    const db = createClient({ url: `file:${directory}/registry.db` })
    try { await db.execute({ sql: 'INSERT INTO repos (id, owner, name, owner_email, reporting_enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)', args: ['fixture-intake', 'owner', 'intake', owner, Date.now()] }) }
    finally { db.close() }
    async function identity(email: string) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const sshKey = keyObjectToSshString(publicKey, email)
      for (const [path, body] of [
        ['/api/admin/users', { email, password: 'disposable-test-password-123', name: email }],
        [`/api/admin/users/${email}/ssh-keys`, { publicKey: sshKey, name: 'Fixture key' }],
      ] as const) {
        const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
        if (!response.ok) throw new Error(`Identity setup failed: ${response.status} ${await response.text()}`)
      }
      const idpToken = await loginWithSshKey(idp.url, email, privateKey, sshKey)
      const exchange = await fetch(`${base}/api/cli/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject_token: idpToken }) })
      if (!exchange.ok) throw new Error(`Exchange failed: ${exchange.status} ${await exchange.text()}`)
      const { access_token: token } = await exchange.json() as { access_token: string }
      const session = new HttpClient()
      const login = await session.postJSON<{ redirectUrl: string }>(`${base}/api/login`, { email })
      if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.data)}`)
      const auth = await session.fetch(login.data.redirectUrl, { headers: { authorization: `Bearer ${idpToken}` } })
      const callback = auth.headers.get('location')
      if (auth.status !== 302 || !callback?.startsWith(`${base}/api/callback?`)) throw new Error(`Unexpected authorization response: ${auth.status} ${callback} ${await auth.text()}`)
      const result = await session.fetch(callback)
      if (result.status !== 302 || result.headers.get('location')?.includes('error=')) throw new Error(`Callback failed: ${result.status} ${result.headers.get('location')} ${await result.text()}`)
      const me = await session.getJSON<{ sub: string }>(`${base}/api/me`)
      if (me.data.sub !== email) throw new Error(`Wrong session: ${JSON.stringify(me.data)}`)
      const home = makeTempDir('native-issue-cli-home-')
      mkdirSync(join(home, '.config/apes'), { recursive: true })
      writeFileSync(join(home, '.config/apes/auth.json'), JSON.stringify({ idp: idp.url, email, access_token: idpToken, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      return {
        token,
        idpToken,
        cookie: session.jar.headerFor(`${base}/api/issues`)!,
        session,
        async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
          return fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        },
        async cli(...args: string[]) {
          const result = await run(process.execPath, [join(root, 'scripts/ape-git.mjs'), 'issue', ...args, '--endpoint', base], { cwd: root, env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }, timeout: 60000 })
          return JSON.parse(result.stdout)
        },
      }
    }
    async function seedBranches(repositoryOwner: string, name: string) {
      const directoryPath = join(directory, 'repos', repositoryOwner, `${name}.git`)
      const git = async (...args: string[]) => (await run('git', ['-C', directoryPath, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: owner, GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: owner } })).stdout.trim()
      const tree = await git('hash-object', '-w', '-t', 'tree', '/dev/null')
      const targetSha = await git('commit-tree', tree, '-m', 'Fixture base')
      const sourceSha = await git('commit-tree', tree, '-p', targetSha, '-m', 'Fixture implementation')
      await git('update-ref', 'refs/heads/main', targetSha)
      await git('update-ref', 'refs/heads/fix-issue', sourceSha)
      return { sourceSha, targetSha }
    }
    async function seedImport(repo: { id: string, owner: string, name: string }, count = 1) {
      const area = join(realpathSync(directory), `migration-${repo.id}`)
      mkdirSync(join(area, 'source/assets'), { recursive: true })
      const bytes = Buffer.from('<html>Imported synthetic diagnostic attachment</html>')
      const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
      const source = 'https://forgejo.example.test'; const repository = `team/${repo.name}`; const date = '2026-01-01T00:00:00Z'
      const assetUrl = `${source}/attachments/00000000-0000-0000-0000-000000000001`
      const snapshot = { format: 1, source, repository, snapshot: { repository: { private: true }, pulls: [{ number: 10 }], labels: [{ id: 1, name: 'imported', color: 'f59e0b' }], issues: [{ id: 7, number: 7, title: 'Imported problem with its original discussion', body: `Original **Markdown**, #7 and \`#7\`.\n\n[Diagnostic attachment](${assetUrl})`, state: 'open', created_at: date, updated_at: date, user: { id: -1, login: 'Ghost' }, labels: [{ id: 1 }], assignees: [], comments: [{ id: 99, body: 'Original comment retained across migration.', created_at: date, updated_at: date, user: { id: 2, login: 'former-maintainer' } }], timeline: [], assets: [], commentAssets: [] }] }, assets: [{ id: 1, issueId: 7, name: 'diagnostic.html', size: bytes.length, sha256: digest(bytes), mimeType: 'text/html', browser_download_url: assetUrl }] }
      if (count > 1) {
        const example = snapshot.snapshot.issues[0]!
        snapshot.snapshot.issues = Array.from({ length: count }, (_, index) => ({ ...example, id: index + 7, number: index + 7, body: 'Synthetic scale issue', comments: [], labels: [], assets: [] }))
        snapshot.assets = []
        snapshot.snapshot.pulls = []
      }
      const history = { source, repository, rows: [] }
      const mapping = { snapshotHash: digest(JSON.stringify(snapshot)), destination: repo, operator: owner, exceptions: { [`unresolved-reference:7:${assetUrl}`]: 'Synthetic attachment preserved as a download' } }
      for (const [path, value] of [['source/snapshot.json', snapshot], ['mapping.json', mapping], ['history.json', history]] as const) writeFileSync(join(area, path), JSON.stringify(value))
      writeFileSync(join(area, 'source/assets', digest(bytes)), bytes)
      const migration = async (...args: string[]) => JSON.parse((await run(process.execPath, [join(root, 'scripts/issue-migration.mjs'), ...args], { cwd: root, timeout: 60000 })).stdout)
      const bundle = join(area, 'bundle')
      const prepared = await migration('prepare', '--snapshot', join(area, 'source'), '--mapping', join(area, 'mapping.json'), '--history', join(area, 'history.json'), '--output', bundle)
      const database = join(realpathSync(directory), 'registry.db'); const assetsDirectory = join(realpathSync(directory), 'issue-assets')
      const approval = { scope: 'isolated', approvedBy: 'synthetic E2E', approvedAt: date, manifestHash: prepared.manifestHash, database, assetsDirectory, destinationId: repo.id }
      writeFileSync(join(area, 'approval.json'), JSON.stringify(approval))
      const applied = await migration('apply', '--bundle', bundle, '--database', database, '--assets', assetsDirectory, '--destination', repo.id, '--approval', join(area, 'approval.json'))
      if (!applied.ok) throw new Error('Synthetic import reconciliation failed')
      const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'))
      return { issueId: manifest.issues[0].id as string, commentId: manifest.comments[0]?.id as string | undefined, attachmentId: manifest.assets[0]?.id as string | undefined, sourceUrl: `${source}/${repository}/issues/7`, bytes }
    }
    return { base, directory, identity, seedBranches, seedImport, stop: async () => { await app!.stop(); await idp.stop() } }
  }
  catch (error) { if (app) await app.stop(); await idp.stop(); throw error }
}
