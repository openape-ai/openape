import { createInterface  } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import consola from 'consola'
import { checkMultiLineStatus } from './multi-line.js'

/**
 * Where the REPL persists its input history across sessions. Lives alongside
 * the existing apes config so we don't add a new top-level dotfile.
 */
const HISTORY_FILE = join(homedir(), '.config', 'apes', 'shell-history')

/**
 * Primary and continuation prompts. PS1 shows when the REPL is ready for a
 * fresh command; PS2 shows when bash syntax is incomplete and the user needs
 * to keep typing (e.g., inside a for-loop or heredoc).
 */
const PS1 = 'apes$ '
const PS2 = '> '

/**
 * Event sink for the REPL. Keeps the loop decoupled from I/O sinks so tests
 * can feed lines and observe outcomes without touching real stdin/stdout.
 */
export interface ReplEvents {
  /**
   * Fires when a complete shell line has been accumulated (possibly across
   * multiple input lines via continuation). The handler is responsible for
   * actually running the line — typically by handing it to the grant flow
   * and then to the pty bridge. In M2 this is just logged; the real wiring
   * lands in M3/M4.
   */
  onLine: (line: string) => void | Promise<void>

  /**
   * Fires when the REPL is about to exit (user pressed Ctrl-D or called
   * `stop`). Gives owners a chance to tear down resources.
   */
  onExit: () => void | Promise<void>
}

/**
 * Optional overrides for tests. Real usage defaults to `process.stdin`,
 * `process.stdout`, and the standard history file path.
 */
export interface ReplOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  historyFile?: string
  /** Disables the session-start banner — handy in tests. */
  quiet?: boolean
}

/**
 * Interactive REPL loop for `ape-shell`. Implements the state machine:
 *
 *   PROMPT → (line entered) → MULTILINE? → (continue) → PROMPT
 *                                 │
 *                                 └─── complete → emit onLine → PROMPT
 *
 * The loop uses node:readline for line editing, history, and signal
 * handling. Multi-line detection runs a `bash -n` dry-parse on Enter to
 * decide whether to fold the input into a longer buffer or submit it.
 *
 * The REPL does NOT know about pty, grants, or bash internals. Owners wire
 * those in via the `onLine` callback. This keeps M2 independently testable.
 */
export class ShellRepl {
  private readonly events: ReplEvents
  private readonly input: NodeJS.ReadableStream
  private readonly output: NodeJS.WritableStream
  private readonly quiet: boolean
  private rl: ReadlineInterface | null = null
  /** Accumulated input across multi-line continuations. */
  private buffer = ''
  /** Whether the REPL has called `stop`. */
  private stopped = false

  constructor(events: ReplEvents, options: ReplOptions = {}) {
    this.events = events
    this.input = options.input ?? process.stdin
    this.output = options.output ?? process.stdout
    this.quiet = options.quiet ?? false
  }

  /**
   * Start the REPL. Resolves when the user ends the session (Ctrl-D) or
   * `stop()` is called from outside. Errors bubble out of `onLine` and
   * cause the line to be rejected, but do NOT tear down the REPL.
   */
  async run(): Promise<void> {
    if (this.stopped)
      return

    this.rl = createInterface({
      input: this.input,
      output: this.output,
      prompt: PS1,
      historySize: 1000,
      // Enable tab completion fallback (file names + history) via default.
      terminal: true,
    })

    if (!this.quiet)
      this.writeBanner()

    this.safePrompt(PS1)

    return new Promise<void>((resolve) => {
      this.rl!.on('line', async (line) => {
        try {
          await this.handleLine(line)
        }
        catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          consola.error(`Shell error: ${msg}`)
          this.resetBuffer()
          this.safePrompt(PS1)
        }
      })

      this.rl!.on('SIGINT', () => {
        // Ctrl-C in prompt mode: clear the buffer, draw a new prompt.
        if (this.buffer.length > 0)
          this.output.write('\n')
        this.resetBuffer()
        this.safePrompt(PS1)
      })

      this.rl!.on('close', async () => {
        // Ctrl-D or stop() — we're done.
        this.stopped = true
        await this.events.onExit()
        resolve()
      })
    })
  }

  /**
   * Request the REPL to stop cleanly. Equivalent to the user pressing
   * Ctrl-D. Typically called during shutdown or after a fatal error.
   */
  stop(): void {
    if (this.rl)
      this.rl.close()
  }

  // ----- internals -----

  private writeBanner(): void {
    this.output.write('apes interactive shell\n')
    this.output.write('Ctrl-D to exit.\n')
    this.output.write('\n')
  }

  private async handleLine(rawLine: string): Promise<void> {
    // Append the new line to the existing buffer. Use a literal newline so
    // bash sees the multi-line structure correctly on `bash -n`.
    this.buffer = this.buffer.length === 0
      ? rawLine
      : `${this.buffer}\n${rawLine}`

    const status = checkMultiLineStatus(this.buffer)

    if (status.kind === 'continue') {
      this.safePrompt(PS2)
      return
    }

    if (status.kind === 'error') {
      this.output.write(`${status.message}\n`)
      this.resetBuffer()
      this.safePrompt(PS1)
      return
    }

    // Complete. Hand off to the owner.
    const completeLine = this.buffer
    this.resetBuffer()

    // If the buffer was pure whitespace, skip the callback and re-prompt.
    if (completeLine.trim().length === 0) {
      this.safePrompt(PS1)
      return
    }

    await this.events.onLine(completeLine)

    // Back to prompt mode. Owners of onLine can await and drive their own
    // output before we show the next prompt.
    this.safePrompt(PS1)
  }

  /**
   * Draw a prompt, but only if the readline interface is still alive.
   * The onLine callback may have triggered `stop()` (e.g., bash exited),
   * in which case setPrompt/prompt would throw ERR_USE_AFTER_CLOSE.
   */
  private safePrompt(prompt: string): void {
    if (this.stopped || !this.rl)
      return
    try {
      this.rl.setPrompt(prompt)
      this.rl.prompt()
    }
    catch (err) {
      // Swallow ERR_USE_AFTER_CLOSE which races with shutdown.
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ERR_USE_AFTER_CLOSE')
        throw err
    }
  }

  private resetBuffer(): void {
    this.buffer = ''
  }
}

export { HISTORY_FILE }
