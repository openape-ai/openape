import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { podEnvironment } from '../src/runtime/environment'
import { executeScript } from '../src/worker/runs/runner'
import type { RunInput } from '../src/contracts/runs'

it('ape-shell: interactive and saved scripts share HOME/workspace and preserve the script channel', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-shared-shell-')))
  const podId = randomUUID(); const host = `pods:${podId}`
  let origin = ''
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url?.startsWith('/api/grants?')) {
      response.end(JSON.stringify({ data: [{ id: 'synthetic-session', status: 'approved', request: { audience: 'ape-shell', target_host: host, grant_type: 'timed' } }] }))
    }
    else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const executable = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture')
  const runtime = { executable, cli: resolve('dist/vendor/apes/ape-shell.mjs'), client: resolve('dist/runtime/shell-client.mjs') }
  try {
    const context = await podEnvironment(root, podId, runtime)
    const auth = join(root, 'auth.json')
    await writeFile(auth, JSON.stringify({ idp: origin, email: 'pod@example.test', access_token: 'synthetic', expires_at: Date.now() / 1000 + 600 }))
    await writeFile(join(context.home, '.bash_profile'), 'echo UNWANTED_PROFILE\n')
    const environment = { ...context.environment, ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1', APES_AUTH_FILE: auth }
    const require = createRequire(resolve('../../packages/apes/package.json'))
    const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty')
    const terminal = pty.spawn(executable, [runtime.cli, '-i'], { cwd: context.workspace, cols: 100, rows: 30, env: environment })
    let output = ''; terminal.onData((bytes) => { output += bytes })
    const exited = new Promise<number>(resolve => terminal.onExit(event => resolve(event.exitCode)))
    try {
      await expect.poll(() => output).toContain('apes$ ')
      terminal.write('printf "hello from terminal" > greeting.txt; printf "CONTEXT:%s:%s\\n" "$HOME" "$PWD"\r')
      await expect.poll(() => output).toContain(`CONTEXT:${context.home}:${context.workspace}`)
      terminal.write('exit\r'); expect(await exited).toBe(0)
    }
    finally { terminal.kill(); await exited }
    expect(output).not.toContain('UNWANTED_PROFILE')
    const directory = join(root, 'run'); await mkdir(directory)
    const artifact = join(directory, 'script.mjs')
    await writeFile(artifact, `import { readFile, writeFile } from 'node:fs/promises';
export async function run(context) {
  const message = await readFile('greeting.txt', 'utf8');
  await writeFile('reply.txt', 'hello from script');
  await context.progress.commit({fixture:true});
  return {status:'completed',summary:JSON.stringify({message,home:process.env.HOME,cwd:process.cwd(),shell:process.env.SHELL}),completedInputIds:[],gapIds:[]};
}`)
    const input: RunInput = { version: 1, runId: randomUUID(), podId, scriptHash: createHash('sha256').update(await readFile(artifact)).digest('hex'), assignmentRevision: 1, reason: 'manual', eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: 0, workspace: context.workspace, references: [], limits: { timeMs: 15000, frameBytes: 256 * 1024 } }
    const operations: string[] = []
    const result = await executeScript({ helper: resolve('dist/native/pods-helper'), executable, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [dirname(dirname(executable))], environment: { ...context.environment, ELECTRON_RUN_AS_NODE: '1' }, home: context.home, shell: { cli: runtime.cli, environment } }, directory, artifact, input, new AbortController().signal, { event: () => {}, request: async (operation) => { operations.push(operation); return { revision: 1 } } })
    expect(result.status).toBe('completed')
    expect(JSON.parse(result.summary)).toEqual({ message: 'hello from terminal', home: context.home, cwd: context.workspace, shell: context.environment.SHELL })
    expect(await readFile(join(context.workspace, 'reply.txt'), 'utf8')).toBe('hello from script')
    expect(operations).toEqual(['progress.commit'])
    expect(requests.filter(url => url.startsWith('/api/grants?')).length).toBeGreaterThanOrEqual(2)
  }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})

it('ape-shell: a denied harmless script command never writes its output file', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-denied-shell-')))
  let origin = ''; let requested = false
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url?.startsWith('/api/grants?')) {
      response.end('{"data":[]}')
    }
    else if (request.url === '/api/grants' && request.method === 'POST') { requested = true; response.end('{"id":"synthetic-denial","status":"denied"}') }
    else if (request.url === '/api/grants/synthetic-denial') {
      response.end('{"status":"denied"}')
    }
    else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const executable = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture')
    const cli = resolve('dist/vendor/apes/ape-shell.mjs')
    const context = await podEnvironment(root, randomUUID(), { executable, cli, client: '' })
    const auth = join(root, 'auth.json')
    await writeFile(auth, JSON.stringify({ idp: origin, email: 'fixture@example.test', access_token: 'synthetic', expires_at: Date.now() / 1000 + 600 }))
    const { spawn } = await import('node:child_process')
    const child = spawn(executable, [cli, '-c', 'printf hello > denied.txt'], { cwd: context.workspace, env: { ...context.environment, ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1', APES_AUTH_FILE: auth } })
    let output = ''; child.stdout.on('data', (bytes) => { output += bytes }); child.stderr.on('data', (bytes) => { output += bytes })
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    expect(requested).toBe(true); expect(code).not.toBe(0); expect(output).toContain('denied')
    await expect(readFile(join(context.workspace, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})
