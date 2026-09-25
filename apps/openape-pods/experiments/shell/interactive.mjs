import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function main() {
  let origin = ''
  const require = createRequire(resolve('packages/apes/package.json'))
  const pty = require('@lydell/node-pty')
  const root = await mkdtemp(join(tmpdir(), 'pods-shell-interactive-')); const home = join(root, 'home'); const workspace = join(root, 'workspace')
  await mkdir(home); await mkdir(workspace)
  const host = 'pods:00000000-0000-4000-8000-000000000001'
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url.startsWith('/api/grants?')) {
      response.end(JSON.stringify({ data: [{ id: 'fixture', status: 'approved', request: { audience: 'ape-shell', target_host: host, grant_type: 'timed' } }] }))
    }
    else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  await writeFile(join(home, 'auth.json'), JSON.stringify({ idp: origin, email: 'pod@example.test', access_token: 'synthetic', expires_at: Date.now() / 1000 + 600 }))
  await writeFile(join(home, '.bash_profile'), 'echo UNWANTED_PROFILE\n')
  const processShell = pty.spawn(process.env.PROBE_RUNTIME ?? process.execPath, [resolve('apps/openape-pods/dist/vendor/apes/ape-shell.mjs'), '-i'], { cwd: workspace, cols: 100, rows: 30, env: { HOME: home, PATH: '/usr/bin:/bin', TERM: 'xterm-256color', ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1', APES_SHELL_CLEAN_START: '1', APES_TARGET_HOST: host, APES_AUTH_FILE: join(home, 'auth.json'), APES_IDP: origin } })
  let output = ''; let stage = 0
  processShell.onData((data) => {
    output += data; if (stage === 0 && output.includes('apes$ ')) { stage = 1; processShell.write('printf "CONTEXT:%s:%s\\n" "$HOME" "$PWD"\r') }
    else if (stage === 1 && output.includes(`CONTEXT:${home}:`)) { stage = 2; processShell.write('exit\r') }
  })
  const timeout = setTimeout(() => processShell.kill(), 12000)
  const result = await new Promise(resolve => processShell.onExit(resolve)); clearTimeout(timeout)
  console.log(JSON.stringify({ result, stage, output }, null, 2))
  await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true })
  if (result.exitCode !== 0 || stage !== 2 || output.includes('UNWANTED_PROFILE'))process.exitCode = 1

}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
