import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'

async function main() {
  let origin = ''
  const root = await mkdtemp(join(tmpdir(), 'pods-ape-shell-probe-'))
  const home = join(root, 'home'); const workspace = join(root, 'workspace')
  await mkdir(home); await mkdir(workspace)
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url })
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url.startsWith('/api/grants?')) {
      response.end(JSON.stringify({ data: [{ id: 'synthetic-session', status: 'approved', request: { audience: 'ape-shell', target_host: process.env.PROBE_TARGET_HOST, grant_type: 'timed' } }] }))
    }
    else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  await writeFile(join(home, 'auth.json'), JSON.stringify({ idp: origin, email: 'fixture-pod@example.test', access_token: 'synthetic-local-token', expires_at: Date.now() / 1000 + 600 }), { mode: 0o600 })
  const nodeScript = join(root, 'probe.mjs')
  await writeFile(nodeScript, `import { writeSync } from 'node:fs'; console.log(JSON.stringify({home:process.env.HOME,cwd:process.cwd(),shell:process.env.SHELL})); try { writeSync(3,'channel-ok'); } catch(e) { console.log('channel:'+e.code); }`)
  const cli = resolve(process.env.PROBE_CLI ?? 'packages/apes/dist/cli.js')
  const quote = value => `'${value.replaceAll('\'', '\'\\\'\'')}'`
  const child = spawn(process.env.PROBE_RUNTIME ?? process.execPath, [cli, '-c', `exec ${quote(process.execPath)} ${quote(nodeScript)}`], { cwd: workspace, env: { ELECTRON_RUN_AS_NODE: '1', HOME: home, PATH: '/usr/bin:/bin', SHELL: 'ape-shell', APES_SHELL_MODE: '1', APES_AUTH_FILE: join(home, 'auth.json'), APES_IDP: origin, APE_WAIT: '1', APES_SHELL_CHANNEL_FD: '3', APES_TARGET_HOST: process.env.PROBE_TARGET_HOST }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''; let channel = ''
  child.stdout.on('data', (chunk) => { stdout += chunk }); child.stderr.on('data', (chunk) => { stderr += chunk }); child.stdio[3].on('data', (chunk) => { channel += chunk })
  const timeout = setTimeout(() => child.kill('SIGTERM'), 15000)
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  clearTimeout(timeout)
  console.log(JSON.stringify({ code, stdout, stderr, channel, requests }, null, 2))
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
  if (code !== 0 || channel !== 'channel-ok') process.exitCode = 1

}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
