import { hostname } from 'node:os'
import consola from 'consola'
import { loadAuth } from '../config.js'
import { requestGrantForShellLine } from './grant-dispatch.js'
import { PtyBridge } from './pty-bridge.js'
import { ShellRepl } from './repl.js'
import { ShellSession } from './session.js'

/**
 * Orchestrates the interactive ape-shell session by wiring the user-facing
 * REPL to a persistent bash child via the PtyBridge. Keeps both components
 * decoupled so each can be unit-tested in isolation.
 *
 * Flow per user-entered line:
 *   1. ShellRepl emits onLine with the completed (possibly multi-line) buffer
 *   2. We switch the REPL into "output mode" (pauses readline, turns on raw
 *      stdin forwarding so TUI apps like vim receive raw keystrokes)
 *   3. The line is written to the bash pty
 *   4. bash output streams back to stdout live via PtyBridge.onOutput
 *   5. When the marker-bearing PS1 reappears we fire a resolve() that lets
 *      the REPL's onLine promise settle → readline takes back the terminal
 *      and shows the next prompt
 *
 * M3 does NOT yet integrate the grant flow — every line is executed
 * unconditionally. M4 inserts grant-dispatch before the pty.write call.
 */
export async function runInteractiveShell(): Promise<void> {
  /**
   * When a line is written into the bash pty, handleLine stashes a
   * resolver here so the PtyBridge's onLineDone can wake it up.
   */
  let pendingResolve: (() => void) | null = null
  let lastExitCode = 0
  let shuttingDown = false
  // Forward reference to the REPL so the bridge's onExit can stop it when
  // bash dies. Assigned after construction below.
  let repl: ShellRepl | null = null

  // Spawn the bash child up-front so the REPL can write to it as soon as the
  // first line is accepted. Output from bash goes straight to the terminal.
  const bridge = new PtyBridge(
    {
      onOutput: (chunk) => {
        // Live streaming to the user's terminal. Always written straight
        // through so TUI apps (vim, less, top) get their escape sequences
        // on time.
        process.stdout.write(chunk)
      },
      onLineDone: (frame) => {
        if (pendingResolve) {
          const r = pendingResolve
          pendingResolve = null
          lastExitCode = frame.exitCode
          r()
        }
      },
      onExit: (exitCode) => {
        // bash itself died — typically because the user ran `exit`.
        // Tear down the REPL so run() returns cleanly.
        if (!shuttingDown) {
          process.stdout.write(`\n[bash exited with code ${exitCode}]\n`)
          repl?.stop()
        }
      },
    },
  )

  await bridge.waitForReady()

  const targetHost = hostname()
  const auth = loadAuth()
  const session = new ShellSession({
    host: targetHost,
    requester: auth?.email ?? 'unknown',
  })

  repl = new ShellRepl(
    {
      onLine: async (line) => {
        // --- 1. Gate the line through the grant flow BEFORE bash sees it ---
        const grant = await requestGrantForShellLine(line, {
          targetHost,
          approval: 'once',
        })

        if (grant.kind === 'denied') {
          session.logLineDenied({ line, reason: grant.reason })
          consola.error(grant.reason)
          return
        }

        const seq = session.logLineGranted({
          line,
          grantId: grant.grantId,
          grantMode: grant.mode,
        })

        // --- 2. Raw-mode stdin passthrough while bash runs the line ---
        const wasRaw = process.stdin.isTTY && (process.stdin as NodeJS.ReadStream).isRaw
        if (process.stdin.isTTY && !wasRaw)
          (process.stdin as NodeJS.ReadStream).setRawMode(true)

        const forward = (chunk: Buffer) => {
          bridge.writeRaw(chunk.toString())
        }
        const rawInputAvailable = process.stdin.isTTY === true
        if (rawInputAvailable)
          process.stdin.on('data', forward)

        try {
          await new Promise<void>((resolve) => {
            pendingResolve = resolve
            bridge.writeLine(line)
          })
        }
        finally {
          if (rawInputAvailable) {
            process.stdin.off('data', forward)
            if (!wasRaw && process.stdin.isTTY)
              (process.stdin as NodeJS.ReadStream).setRawMode(false)
          }
        }

        session.logLineDone({ seq, exitCode: lastExitCode })

        if (lastExitCode !== 0) {
          consola.debug(`(exit ${lastExitCode})`)
        }
      },
      onExit: () => {
        shuttingDown = true
        session.close()
        try {
          bridge.kill()
        }
        catch {}
      },
    },
  )

  // SIGWINCH forwarding so TUI apps re-render at the right dimensions.
  const onResize = () => {
    const cols = process.stdout.columns ?? 80
    const rows = process.stdout.rows ?? 24
    try {
      bridge.resize(cols, rows)
    }
    catch {}
  }
  process.stdout.on('resize', onResize)

  try {
    await repl.run()
  }
  finally {
    process.stdout.off('resize', onResize)
  }
}
