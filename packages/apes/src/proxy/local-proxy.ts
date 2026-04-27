import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

export interface EphemeralProxy {
  url: string
  port: number
  child: ChildProcess
  close: () => Promise<void>
}

/**
 * Resolve the absolute path to the `openape-proxy` executable shipped by the
 * `@openape/proxy` workspace package. Uses `require.resolve` against the
 * package's `package.json` so it works both in the workspace (where pnpm
 * symlinks the package into `node_modules/@openape/proxy`) and after a
 * regular `npm install -g @openape/apes` global install.
 */
export function findProxyBin(): string {
  const pkgPath = require.resolve('@openape/proxy/package.json')
  const pkg = require('@openape/proxy/package.json') as { bin?: Record<string, string> }
  const binRel = pkg.bin?.['openape-proxy']
  if (!binRel) {
    throw new Error('@openape/proxy is missing the openape-proxy bin entry')
  }
  return resolve(dirname(pkgPath), binRel)
}

/**
 * Spawn an ephemeral `openape-proxy` child process bound to a random free
 * port on 127.0.0.1. Resolves once the child has logged its `Listening on …`
 * line. Caller MUST `close()` to terminate the child + clean up the temp
 * config directory.
 *
 * Why temp file instead of stdin: the proxy binary today only accepts
 * `-c <path>`. Once it grows a stdin/env mode we can drop the temp dir.
 */
export async function startEphemeralProxy(configToml: string): Promise<EphemeralProxy> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'openape-proxy-'))
  const configPath = join(tmpDir, 'config.toml')
  writeFileSync(configPath, configToml, { mode: 0o600 })

  const binPath = findProxyBin()
  const child = spawn(process.execPath, [binPath, '-c', configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  const cleanupTmp = () => {
    try { rmSync(tmpDir, { recursive: true, force: true }) }
    catch { /* best effort */ }
  }

  let port: number
  try {
    port = await waitForListenLine(child)
  }
  catch (err) {
    child.kill('SIGTERM')
    cleanupTmp()
    throw err
  }

  // Surface unexpected proxy stderr to ours so users can see crashes.
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    child,
    close: () => new Promise<void>((resolveClose) => {
      const done = () => {
        cleanupTmp()
        resolveClose()
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        done()
        return
      }
      child.once('exit', done)
      child.kill('SIGTERM')
      // Force-kill if SIGTERM doesn't take within 2s.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }, 2000).unref()
    }),
  }
}

/**
 * Read the proxy's stdout until we see the `Listening on http://…:<port>`
 * banner. Rejects if the child exits early or the timeout fires.
 *
 * `setTimeout(...).unref()` so the timer doesn't keep the apes process
 * alive past its natural exit if everything else has finished.
 */
function waitForListenLine(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolveWait, rejectWait) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      const m = buf.match(/Listening on http:\/\/[^:\s]+:(\d+)/)
      if (m) {
        cleanup()
        resolveWait(Number(m[1]))
      }
    }
    const onExit = (code: number | null) => {
      cleanup()
      rejectWait(new Error(`openape-proxy exited before listening (code=${code}, stderr accumulated above)`))
    }
    const onError = (err: Error) => {
      cleanup()
      rejectWait(err)
    }
    const timer = setTimeout(() => {
      cleanup()
      rejectWait(new Error('openape-proxy startup timeout (5s)'))
    }, 5000)
    timer.unref()

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    child.stdout?.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}
