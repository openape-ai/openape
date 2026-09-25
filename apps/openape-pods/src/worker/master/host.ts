import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { Socket } from 'node:net'

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')) as { binary: string, profile: string, home: string, environment: Record<string, string> }
  const channel = new Socket({ fd: 3, readable: true, writable: true })
  const child = spawn('/usr/bin/sandbox-exec', ['-f', config.profile, config.binary, '--strict-config', 'app-server', '--stdio'], { cwd: config.home, env: config.environment, stdio: ['pipe', 'pipe', 'pipe'] })
  channel.pipe(child.stdin); child.stdout.pipe(channel); child.stderr.pipe(process.stderr)
  const fail = (error: Error) => { console.error(error.message); channel.destroy(); child.kill('SIGTERM'); process.exitCode = 1 }
  channel.on('error', fail); child.stdin.on('error', fail); child.on('error', fail)
  channel.on('close', () => child.kill('SIGTERM'))
  await new Promise<void>((resolve) => { child.once('close', (code) => { process.exitCode = code ?? 1; channel.destroy(); resolve() }) })
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Master host failed'); process.exitCode = 1 })
