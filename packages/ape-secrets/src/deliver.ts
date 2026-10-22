import { spawn } from 'node:child_process'
import { open, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'

export type Sink = { file: string } | { command: string[], env?: string }
export async function prepareSink(sink: Sink) {
  let file: FileHandle | undefined
  if ('file' in sink) {
    file = await open(sink.file, 'wx', 0o600)
  }
  else {
    if (!sink.command.length || sink.command.some(v => typeof v !== 'string' || v.includes('\0')) || !sink.command[0]) throw new Error('Provide a JSON array with executable and arguments')
    if (sink.env && !/^[A-Z_]\w*$/i.test(sink.env)) throw new Error('Invalid environment variable name')
  }
  let delivered = false
  return {
    async write(value: Uint8Array<ArrayBuffer>) {
      try {
        if (file) { await file.writeFile(value); await file.sync(); delivered = true; return }
        if ('file' in sink) throw new Error('Output file unavailable')
        if (sink.env && value.includes(0)) throw new Error('Environment values cannot contain NUL')
        // No shell and no inherited output: even a failing target cannot echo the
        // value back into an agent's transcript. Only exit status is returned.
        await new Promise<void>((resolve, reject) => {
          const child = spawn(sink.command[0]!, sink.command.slice(1), {
            shell: false,
            stdio: ['pipe', 'ignore', 'ignore'],
            env: sink.env ? { ...process.env, [sink.env]: new TextDecoder().decode(value) } : process.env,
          })
          child.on('error', () => reject(new Error('Target process could not start')))
          child.on('close', code => code === 0 ? resolve() : reject(new Error(`Target process exited with status ${code}`)))
          child.stdin.on('error', () => reject(new Error('Target process did not accept the secret')))
          child.stdin.end(sink.env ? undefined : value)
        })
        delivered = true
      }
      finally { value.fill(0) }
    },
    async close() {
      await file?.close()
      if (file && !delivered && 'file' in sink) await unlink(sink.file).catch(() => {})
    },
  }
}
