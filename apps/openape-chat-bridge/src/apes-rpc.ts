// Long-lived `apes agents serve --rpc` subprocess per chat conversation.
//
// Protocol (line-delimited JSON, one record per `\n`):
//
//   inbound (one per turn):
//     { "type": "message",
//       "session_id": "<roomId>:<threadId>",
//       "system_prompt": "...",
//       "tools":  [...],
//       "max_steps": 10,
//       "model": "claude-haiku-4-5",
//       "user_msg": "..." }
//
//   outbound (multiple per turn, terminated by 'done'):
//     { "type": "text_delta",   "session_id": "...", "delta": "..." }
//     { "type": "tool_call",    "session_id": "...", "name": "...", "args": {...} }
//     { "type": "tool_result",  "session_id": "...", "name": "...", "result": ... }
//     { "type": "tool_error",   "session_id": "...", "name": "...", "error": "..." }
//     { "type": "done",         "session_id": "...", "step_count": N, "status": "ok"|"error", "final_message": "..." }
//     { "type": "error",        "session_id": "...", "message": "..." }
//
// We split only on `\n` (not Node's readline which also splits on
// U+2028 / U+2029) — same constraint pi-rpc had, same justification.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface ApesRpcOptions {
  binary: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

/** Outbound event shape emitted by `apes agents serve --rpc`. */
export interface ApesEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'tool_error' | 'done' | 'error' | string
  session_id?: string
  delta?: string
  name?: string
  args?: unknown
  result?: unknown
  error?: string
  step_count?: number
  status?: 'ok' | 'error'
  final_message?: string | null
  message?: string
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
      // Bad line — bridge stderr leak or runtime printf debug. Drop.
    }
  }
  return { events, rest }
}

export interface PromptInput {
  sessionId: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  model: string
  userMsg: string
}

export class ApesRpcSession {
  private proc: ChildProcessWithoutNullStreams
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private listeners: Array<(event: ApesEvent) => void> = []
  private exitListeners: Array<(code: number | null) => void> = []
  private exited = false

  constructor(opts: ApesRpcOptions) {
    this.proc = spawn(opts.binary, opts.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    })

    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => {
      const { events, rest } = pumpJsonl(this.stdoutBuffer, chunk)
      this.stdoutBuffer = rest
      for (const ev of events) {
        for (const fn of this.listeners) {
          try { fn(ev as ApesEvent) }
          catch (err) {
            process.stderr.write(`apes-rpc listener threw: ${err instanceof Error ? err.message : String(err)}\n`)
          }
        }
      }
    })

    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      process.stderr.write(`[apes-rpc] ${chunk}`)
      if (this.stderrBuffer.length > 8192) {
        this.stderrBuffer = this.stderrBuffer.slice(-4096)
      }
    })

    this.proc.on('exit', (code) => {
      this.exited = true
      for (const fn of this.exitListeners) {
        try { fn(code) }
        catch { /* listener errors must not mask the exit */ }
      }
    })
  }

  isAlive(): boolean {
    return !this.exited
  }

  recentStderr(): string {
    return this.stderrBuffer.slice(-4096)
  }

  /** Send one inbound `message` to the runtime. */
  prompt(input: PromptInput): void {
    if (this.exited) {
      throw new Error('apes-rpc subprocess has exited')
    }
    const payload = {
      type: 'message',
      session_id: input.sessionId,
      system_prompt: input.systemPrompt,
      tools: input.tools,
      max_steps: input.maxSteps,
      model: input.model,
      user_msg: input.userMsg,
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  on(listener: (event: ApesEvent) => void): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter(l => l !== listener) }
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener)
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.exited) return
    try { this.proc.kill(signal) }
    catch { /* already gone */ }
  }
}
