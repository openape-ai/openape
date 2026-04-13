import { randomBytes } from 'node:crypto'
import type { IPty } from 'node-pty'
import * as pty from 'node-pty'

/**
 * Frame returned when the bash child finishes executing a line and is ready
 * for the next one. The `output` is everything bash printed since the last
 * frame, with the marker line stripped.
 */
export interface CompletedLineFrame {
  output: string
  exitCode: number
}

/**
 * Callbacks the PtyBridge delivers to its owner. `onOutput` fires with
 * streaming pty output chunks (marker content already stripped). `onLineDone`
 * fires once per completed shell line with the cumulative output and the
 * exit code extracted from the prompt marker. `onExit` fires when the bash
 * child itself has terminated (user typed `exit`, or the process died).
 */
export interface PtyBridgeEvents {
  onOutput: (chunk: string) => void
  onLineDone: (frame: CompletedLineFrame) => void
  onExit: (exitCode: number, signal: number | undefined) => void
}

/**
 * Wraps a persistent bash child running inside a pty. Each time the frontend
 * feeds a line via `writeLine`, the bridge streams bash's stdout back through
 * `onOutput` until it detects the marker-bearing PS1 — at which point the
 * line is considered complete and `onLineDone` fires with the captured
 * output and the exit code.
 *
 * The marker format embedded in PS1 is:
 *   __APES_<random-hex>__:<exit-code>:__END__
 * The leading token is a 32-char random hex so output collisions are
 * effectively impossible. `<exit-code>` is `$?` at prompt render time.
 *
 * The marker itself is stripped from the output stream before it is
 * forwarded to the caller, so consumers never see it on their terminal.
 */
export class PtyBridge {
  private readonly marker: string
  /** Compiled once. Captures the exit code in group 1. */
  private readonly markerRegex: RegExp
  private readonly term: IPty
  private readonly events: PtyBridgeEvents
  /** Bytes received since the last completed line. Searched for the marker. */
  private pending = ''
  /**
   * Accumulated output for the current in-flight line. Streams to `onOutput`
   * live as chunks arrive, and is handed to `onLineDone` in full when the
   * marker is matched. Resets at that point.
   */
  private currentLineBuffer = ''
  /** True until bash prints its first marker-prompt. */
  private readyForFirstLine = false
  private awaitingInitialPrompt: ((value: void) => void) | null = null

  constructor(events: PtyBridgeEvents, options: { cols?: number, rows?: number, cwd?: string } = {}) {
    this.events = events
    this.marker = randomBytes(16).toString('hex')
    // Example match: __APES_abc123…__:0:__END__
    // The `\r?\n?` tolerates line endings around the marker depending on
    // how bash renders PS1 on a fresh line.
    this.markerRegex = new RegExp(
      `__APES_${this.marker}__:(-?\\d+):__END__\\r?\\n?`,
    )

    const cols = options.cols ?? process.stdout.columns ?? 80
    const rows = options.rows ?? process.stdout.rows ?? 24

    // We spawn bash as `--login -i` so the user's ~/.bash_profile / ~/.bashrc
    // runs and they get their aliases/functions. Trade-off: if the user
    // overrides PS1 in their rcfile, our marker detection breaks. We protect
    // against that by re-exporting PS1 via PROMPT_COMMAND on every prompt.
    //
    // PROMPT_COMMAND also runs `stty -echo` so the pty line discipline stops
    // echoing user input back to us. Without this, every line the frontend
    // writes to the pty gets echoed into the output stream — causing the
    // command to appear twice in the user's terminal (once from readline,
    // once from the pty echo). The frontend already owns its own display of
    // what the user typed; the pty echo is redundant and surprising.
    // Interactive TUI apps (vim/less/top) set their own termios when they
    // start, so they are unaffected.
    // Strip APES_SHELL_WRAPPER so nested `apes` invocations inside the pty
    // don't self-detect as ape-shell mode and reject their argv. The wrapper
    // script sets this marker on the parent ape-shell process; leaking it
    // into bash would cause `apes <subcommand>` at the REPL prompt to print
    // "unsupported invocation" instead of running.
    const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env
    this.term = pty.spawn('bash', ['--login', '-i'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...inheritedEnv,
        // Force our marker PS1 on every prompt and keep pty echo off —
        // both survive .bashrc overrides because PROMPT_COMMAND runs
        // before each prompt.
        PROMPT_COMMAND: `stty -echo 2>/dev/null; PS1='__APES_${this.marker}__:$?:__END__'`,
        // Also set it initially so the very first prompt carries the marker.
        PS1: `__APES_${this.marker}__:$?:__END__`,
        PS2: '> ',
        // Silence bash-specific onboarding that would pollute our output.
        BASH_SILENCE_DEPRECATION_WARNING: '1',
      },
    })

    this.term.onData(chunk => this.handleData(chunk))
    this.term.onExit(({ exitCode, signal }) => {
      this.events.onExit(exitCode, signal)
    })
  }

  /**
   * Resolves once bash has printed its very first marker-bearing prompt,
   * which means it has finished sourcing ~/.bashrc and is ready to accept
   * input. Callers should await this before sending the first line.
   */
  waitForReady(): Promise<void> {
    if (this.readyForFirstLine)
      return Promise.resolve()
    return new Promise((resolve) => {
      this.awaitingInitialPrompt = resolve
    })
  }

  /**
   * Write a shell command line to bash's stdin. The caller must ensure the
   * line has already been approved by the grant flow. The bridge does NOT
   * validate or filter the line.
   */
  writeLine(line: string): void {
    // Trim trailing newlines and always append exactly one, so pasting a
    // multi-line string works naturally.
    const clean = line.replace(/\r?\n+$/, '')
    this.term.write(`${clean}\n`)
  }

  /**
   * Raw passthrough write — used for forwarding user keystrokes during
   * interactive output mode (e.g. while vim is running).
   */
  writeRaw(data: string): void {
    this.term.write(data)
  }

  /** Resize the underlying pty. Called on SIGWINCH. */
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  /** Kill the bash child. Called on Ctrl-D / shell exit. */
  kill(signal?: string): void {
    this.term.kill(signal)
  }

  /** Process id of the bash child, for logging / debugging. */
  get pid(): number {
    return this.term.pid
  }

  /** Exposed for tests that want to look at the raw marker. */
  getMarkerForTest(): string {
    return this.marker
  }

  // ----- internals -----

  private handleData(chunk: string): void {
    this.pending += chunk

    // Walk through any complete marker matches. Each marker ends the current
    // in-flight line; the `before` slice is its final output.
    for (;;) {
      const match = this.pending.match(this.markerRegex)
      if (!match || match.index === undefined)
        break

      const before = this.pending.slice(0, match.index)
      const exitCode = Number(match[1])
      // Stream the pre-marker portion live (for REPL display) AND fold it
      // into the per-line buffer so the `onLineDone` frame is complete.
      if (before.length > 0) {
        this.currentLineBuffer += before
        if (this.readyForFirstLine)
          this.events.onOutput(before)
      }
      // Drop the matched marker and everything before it from the buffer
      this.pending = this.pending.slice(match.index + match[0].length)

      if (!this.readyForFirstLine) {
        // Bootstrap prompt: discard any bash startup noise we captured and
        // signal readiness. onLineDone does NOT fire for the implicit
        // first prompt — that would confuse consumers.
        this.readyForFirstLine = true
        this.currentLineBuffer = ''
        const resolve = this.awaitingInitialPrompt
        this.awaitingInitialPrompt = null
        if (resolve)
          resolve()
        continue
      }

      // Real command completion: hand over the accumulated line buffer.
      const frame = { output: this.currentLineBuffer, exitCode }
      this.currentLineBuffer = ''
      this.events.onLineDone(frame)
    }

    // No more markers in the buffer. If we're past bootstrap, stream any
    // complete lines that have accumulated so the user sees live output,
    // and keep any partial tail in `pending` in case the marker is still
    // mid-chunk.
    if (!this.readyForFirstLine)
      return

    const lastNewline = this.pending.lastIndexOf('\n')
    if (lastNewline >= 0) {
      const ready = this.pending.slice(0, lastNewline + 1)
      this.pending = this.pending.slice(lastNewline + 1)
      if (ready.length > 0) {
        this.currentLineBuffer += ready
        this.events.onOutput(ready)
      }
    }
  }
}
