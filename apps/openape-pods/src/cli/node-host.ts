import { EventEmitter } from 'node:events'
import { fork, spawn } from 'node:child_process'
import type { RuntimeHost } from '../main/runtime-host'
import { CredentialCache } from '../main/connections/cache'
import { macOSCipher } from './safe-storage'

export function nodeHost(dist: string): RuntimeHost {
  return {
    directory: dist,
    oneShot: true,
    apesCli: `${dist}/vendor/apes/ape-shell.mjs`,
    credentials: root => new CredentialCache(root, macOSCipher(`${dist}/native/pods-keychain`)),
    openExternal: async (url) => {
      process.stderr.write(`Approval: ${url}\n`)
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' })
        child.once('error', reject)
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not open the approval page')))
      })
    },
    fork: (entry, options) => {
      const child = fork(entry, [], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] })
      const events = new EventEmitter()
      child.on('message', message => events.emit('message', message))
      child.on('exit', code => events.emit('exit', code ?? 1))
      child.on('error', (error) => { process.stderr.write(`Worker: ${error.message}\n`); child.kill() })
      return Object.assign(events, {
        pid: child.pid,
        stderr: child.stderr,
        postMessage: (message: unknown) => {
          if (!child.connected) throw new Error('Pods worker disconnected')
          child.send(message as Parameters<typeof child.send>[0])
        },
        kill: () => { child.kill('SIGKILL') },
      })
    },
  }
}
