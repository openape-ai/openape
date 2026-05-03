// Long-lived pi RPC subprocess per chat conversation.
//
// Pi's RPC protocol (https://pi.dev/docs/latest/rpc): launch with
// `--mode rpc`, send commands as JSON lines on stdin, receive events
// + responses as JSON lines on stdout. The protocol is strict about
// only splitting on `\n` — Node's readline must NOT be used because it
// also splits on U+2028 / U+2029.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface PiRpcOptions {
  binary: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface AssistantMessageDelta {
  type: 'text_delta' | 'thinking_delta' | 'toolcall_delta' | 'done'
  delta?: string
  contentIndex?: number
  [k: string]: unknown
}

/**
 * Pi RPC event shape. We only model the fields the bridge actually reads;
 * unknown event kinds still flow through (the `type` field is always a
 * string) but pattern-matching code should `switch (event.type)` and ignore
 * non-handled cases.
 */
export interface PiEvent {
  type: string
  // message_update payload
  assistantMessageEvent?: AssistantMessageDelta
  // agent_end / message_end / message_start payload
  messages?: unknown[]
  message?: unknown
  // tool_execution_* payload
  toolCallId?: string
  toolName?: string
  args?: unknown
  partialResult?: unknown
  result?: unknown
  isError?: boolean
  // RPC response shape
  id?: string
  command?: string
  success?: boolean
  error?: string
  // catch-all
  [k: string]: unknown
}

/**
 * Buffer-based JSONL splitter that treats only `\n` as a record terminator.
 * Returns the parsed records and keeps any trailing partial line for the
 * next chunk. Exported for unit testing.
 */
export function pumpJsonl(buffer: string, chunk: string): { events: unknown[], rest: string } {
  const combined = buffer + chunk
  const lines = combined.split('\n')
  const rest = lines.pop() ?? ''
  const events: unknown[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    }
    catch {
      // ignore malformed line — pi guarantees valid JSON per the spec,
      // so if we see a bad line it's likely a stderr leak we can drop.
    }
  }
  return { events, rest }
}

export class PiRpcSession {
  private proc: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private listeners: Array<(event: PiEvent) => void> = []
  private exitListeners: Array<(code: number | null) => void> = []
  private exited = false

  constructor(opts: PiRpcOptions) {
    this.proc = spawn(opts.binary, ['--mode', 'rpc', ...opts.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    })

    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => {
      const { events, rest } = pumpJsonl(this.stdoutBuffer, chunk)
      this.stdoutBuffer = rest
      for (const ev of events) {
        for (const fn of this.listeners) {
          try { fn(ev as PiEvent) }
          catch (err) {
            process.stderr.write(`pi-rpc listener threw: ${err instanceof Error ? err.message : String(err)}\n`)
          }
        }
      }
    })

    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      // Surface every line of stderr as it arrives — pi prints diagnostic
      // info there. Keep a rolling tail in stderrBuffer so a crash report
      // can include the last few lines.
      process.stderr.write(`[pi] ${chunk}`)
      if (this.stderrBuffer.length > 8192) {
        this.stderrBuffer = this.stderrBuffer.slice(-4096)
      }
    })

    this.proc.on('exit', (code) => {
      this.exited = true
      for (const fn of this.exitListeners) {
        try { fn(code) }
        catch {
          // listener errors must not mask the exit
        }
      }
    })
  }

  isAlive(): boolean {
    return !this.exited
  }

  recentStderr(): string {
    return this.stderrBuffer.slice(-4096)
  }

  send(command: Record<string, unknown>): void {
    if (this.exited) {
      throw new Error('pi-rpc subprocess has exited')
    }
    this.proc.stdin.write(`${JSON.stringify(command)}\n`)
  }

  prompt(message: string, opts?: { id?: string }): void {
    this.send({ type: 'prompt', message, ...(opts?.id ? { id: opts.id } : {}) })
  }

  on(listener: (event: PiEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener)
    }
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener)
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.exited) return
    try { this.proc.kill(signal) }
    catch {
      // already gone
    }
  }
}
