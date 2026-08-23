/**
 * Turning `waits_until` into something an approver can act on.
 *
 * The requester waits about five minutes; the card stands for 48 hours. Past
 * the caller's deadline the command can no longer run whatever the owner
 * clicks — an approval then only means "allow requests like this in future",
 * which is a different decision and must be presented as one (#1306).
 */

export type CallerState =
  /** Still polling: a decision now actually does something. */
  | { kind: 'waiting', secondsLeft: number }
  /** Gave up: only a rule can still come of this. */
  | { kind: 'abandoned', waitedSeconds: number }
  /** The requester never said. Claim nothing. */
  | { kind: 'unknown' }

export function callerState(
  request: { waits_until?: number } | undefined,
  createdAt: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): CallerState {
  const until = request?.waits_until
  if (typeof until !== 'number') return { kind: 'unknown' }
  if (nowSec < until) return { kind: 'waiting', secondsLeft: until - nowSec }
  return { kind: 'abandoned', waitedSeconds: Math.max(0, until - createdAt) }
}

/**
 * `4:07` for the short waits a shell command makes, `23 h 59 min` for the long
 * ones a review can afford. Counting a day out in minutes (`1439:45`) reads as
 * a stopwatch nobody can convert in their head.
 */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, secondsLeft)
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

/** How long the caller was prepared to wait, for the abandoned note. */
export function formatWaited(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.round(seconds / 60)
    return `${min} min`
  }
  return `${seconds} s`
}
