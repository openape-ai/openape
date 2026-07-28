/**
 * Periodic progress output for grant-approval wait loops (#1065).
 *
 * A pending grant can sit in a poll loop for up to five minutes. Without
 * any output a caller cannot tell "still waiting for a human" from
 * "hung", and stall heuristics (e.g. the OpenApe worker kills tasks
 * after 150 s without stream output) terminate healthy waits. The
 * reporter therefore emits a short line every {@link WAIT_PROGRESS_INTERVAL_MS}
 * — on **stderr** only, because stdout carries the command output that
 * callers parse.
 */

export const WAIT_PROGRESS_INTERVAL_MS = 15_000

/**
 * Create a progress reporter for one wait loop. Call the returned
 * function on every poll tick; it writes a line to stderr whenever
 * {@link WAIT_PROGRESS_INTERVAL_MS} has elapsed since the last one, e.g.
 *
 *   ⏳ still waiting for approval … 45s (grant a1b2c3d4)
 *
 * Nothing is written when the wait resolves before the first interval.
 * Set `APES_QUIET_WAIT=1` to suppress the output entirely (the wait-loop
 * sibling of `APES_QUIET_GRANT_REUSE`).
 */
export function createWaitProgressReporter(grantId: string): () => void {
  const start = Date.now()
  let lastReport = start

  return () => {
    if (process.env.APES_QUIET_WAIT === '1')
      return
    const now = Date.now()
    if (now - lastReport < WAIT_PROGRESS_INTERVAL_MS)
      return
    lastReport = now
    const elapsedSeconds = Math.round((now - start) / 1000)
    process.stderr.write(`⏳ still waiting for approval … ${elapsedSeconds}s (grant ${grantId.slice(0, 8)})\n`)
  }
}
