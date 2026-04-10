import { randomBytes } from 'node:crypto'
import { appendAuditLog } from '../shapes/index.js'

/**
 * A single interactive ape-shell session. Tracks a stable session id plus a
 * monotonic sequence number so individual lines can be correlated back to
 * their session in the audit log.
 */
export class ShellSession {
  readonly id: string
  readonly startedAt: number
  private lineSeq = 0

  constructor(options: { host: string, requester: string }) {
    this.id = randomBytes(8).toString('hex')
    this.startedAt = Date.now()
    appendAuditLog({
      action: 'shell-session-start',
      session_id: this.id,
      host: options.host,
      requester: options.requester,
    })
  }

  /**
   * Record a granted line that was approved for execution. Called after the
   * grant flow returns approval but before (or right after) bash runs the
   * command. Stores the grant id so the line can be traced back to the
   * specific grant that authorized it.
   */
  logLineGranted(params: {
    line: string
    grantId: string
    grantMode: 'adapter' | 'session'
  }): number {
    const seq = ++this.lineSeq
    appendAuditLog({
      action: 'shell-session-line',
      session_id: this.id,
      seq,
      line: params.line,
      grant_id: params.grantId,
      grant_mode: params.grantMode,
      status: 'executing',
    })
    return seq
  }

  /** Record the final exit code of a previously-granted line. */
  logLineDone(params: { seq: number, exitCode: number }): void {
    appendAuditLog({
      action: 'shell-session-line-done',
      session_id: this.id,
      seq: params.seq,
      exit_code: params.exitCode,
    })
  }

  /** Record that a line was denied by the grant flow and never reached bash. */
  logLineDenied(params: { line: string, reason: string }): void {
    const seq = ++this.lineSeq
    appendAuditLog({
      action: 'shell-session-line',
      session_id: this.id,
      seq,
      line: params.line,
      status: 'denied',
      reason: params.reason,
    })
  }

  /** Record session termination. Fires on clean Ctrl-D or bash death. */
  close(): void {
    appendAuditLog({
      action: 'shell-session-end',
      session_id: this.id,
      duration_ms: Date.now() - this.startedAt,
      lines: this.lineSeq,
    })
  }
}
