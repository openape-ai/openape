import { readFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')) as { endpoint: string, token: string, name: string, podId: string, workspace: string, environment: Record<string, string>, executable: string, cli: string, command?: string }
  const socket = connect(config.endpoint)
  let child: ChildProcess | undefined; let buffer = ''; let completed = false; let killer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (!child || completed) return
    const signal = (value: NodeJS.Signals) => {
      try { if (config.command && child?.pid) process.kill(-child.pid, value); else child?.kill(value) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    signal('SIGTERM')
    killer ??= setTimeout(signal, 4000, 'SIGKILL')
  }
  const ignoreInterrupt = () => {}
  process.on('SIGINT', ignoreInterrupt); process.on('SIGTERM', stop); process.on('SIGHUP', stop)
  socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'attach', token: config.token })}\n`))
  const heartbeat = setInterval(() => { if (!socket.destroyed) socket.write('{"type":"heartbeat"}\n') }, 5000)
  const finished = new Promise<void>((resolve, reject) => {
    socket.on('error', (error) => { stop(); if (!child) reject(error) })
    socket.on('close', () => { stop(); reject(new Error('Pod terminal service closed before confirming saved setup')) })
    socket.on('data', (bytes) => {
      buffer += bytes.toString()
      if (buffer.length > 4096) { stop(); socket.destroy(); return }
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        try {
          const message = JSON.parse(line) as { ready?: boolean, stop?: boolean, saved?: boolean, error?: string }
          if (message.error) { reject(new Error(message.error)); continue }
          if (message.saved && completed) { resolve(); continue }
          if (message.stop) { stop(); continue }
          if (!message.ready || child) throw new Error('Unexpected pod terminal response')
          const name = Array.from(config.name).filter((character) => { const code = character.codePointAt(0)!; return code >= 32 && (code < 127 || code > 159) }).join('')
          process.stdout.write(`\u001B]0;OpenApe Pod ${name}\u0007\nPod: ${name} (${config.podId})\nHOME: ${config.environment.HOME}\nWorkspace: ${config.workspace}\nShell: ${config.environment.SHELL}\n\n`)
          child = spawn(config.executable, [config.cli, ...(config.command ? ['-c', config.command] : ['-i'])], { cwd: config.workspace, detached: !!config.command, env: { ...config.environment, ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1' }, stdio: 'inherit' })
          child.on('error', reject)
          child.on('close', (code) => {
            completed = true; process.exitCode = code ?? 1
            if (!socket.destroyed) socket.write(`${JSON.stringify({ type: 'done', code: code ?? 1 })}\n`)
            else reject(new Error('Pod terminal connection was lost before saving setup'))
          })
        }
        catch (error) { stop(); socket.destroy(); reject(error) }
      }
    })
  })
  try { await finished }
  finally { clearInterval(heartbeat); if (killer) clearTimeout(killer); socket.destroy(); process.off('SIGINT', ignoreInterrupt); process.off('SIGTERM', stop); process.off('SIGHUP', stop) }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Pod terminal failed'); process.exitCode = 1 })
