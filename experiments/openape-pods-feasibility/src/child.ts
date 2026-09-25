import { chmodSync, copyFileSync, linkSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { connect } from 'node:net'

const [operation, ...args] = process.argv.slice(2)
function argument(index: number): string {
  const value = args[index]
  if (value === undefined)
    throw new Error(`Missing argument ${index}`)
  return value
}

function exec(executable: string, commandArgs: string[]): void {
  const result = spawnSync(executable, commandArgs, { encoding: 'utf8', timeout: 3000 })
  if (result.error)
    throw result.error
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.status ?? 1
}

async function run(): Promise<void> {
  process.stderr.write(`PROBE_STARTED:${operation} pid=${process.pid} ppid=${process.ppid}\n`)
  switch (operation) {
    case 'read':
      process.stdout.write(readFileSync(argument(0)))
      return
    case 'write':
      writeFileSync(argument(0), 'synthetic update')
      return
    case 'chmod':
      chmodSync(argument(0), 0o600)
      return
    case 'rename':
      renameSync(argument(0), argument(1))
      return
    case 'unlink':
      unlinkSync(argument(0))
      return
    case 'link':
      linkSync(argument(0), argument(1))
      return
    case 'copy-exec':
      copyFileSync(argument(0), argument(1))
      exec(argument(1), [argument(2)])
      return
    case 'exec':
      exec(argument(0), args.slice(1))
      return
    case 'descriptor':
      process.stdout.write(readFileSync(42))
      return
    case 'replace-symlink':
      unlinkSync(argument(0))
      symlinkSync(argument(1), argument(0))
      process.stdout.write(readFileSync(argument(0)))
      return
    case 'network':
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port: Number(argument(0)) })
        socket.setTimeout(2000, () => socket.destroy(new Error('Connection timed out')))
        socket.once('connect', () => { socket.end(); resolve() })
        socket.once('error', reject)
      })
      return
    default:
      throw new Error(`Unknown probe operation: ${operation}`)
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
