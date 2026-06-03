// Cost / kill controls (M6). A per-task budget the coding loop checks
// between steps: token spend + wall-clock + an external kill-switch.
// Pure + unit-tested; the loop calls `check()` each iteration and aborts
// cleanly (posting status) when it throws.

export interface BudgetLimits {
  maxTokens?: number
  maxWallMs?: number
}

export class BudgetExceededError extends Error {
  constructor(public readonly kind: 'tokens' | 'wallclock' | 'killed', message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

export class BudgetTracker {
  private tokens = 0
  private readonly startedAt: number
  private killed = false

  constructor(private readonly limits: BudgetLimits = {}, now: number = Date.now()) {
    this.startedAt = now
  }

  addTokens(n: number): void {
    if (n > 0) this.tokens += n
  }

  kill(): void {
    this.killed = true
  }

  spentTokens(): number {
    return this.tokens
  }

  elapsedMs(now: number = Date.now()): number {
    return now - this.startedAt
  }

  // Throws BudgetExceededError when any limit is breached. Call between
  // loop steps. `now` is injectable for testing.
  check(now: number = Date.now()): void {
    if (this.killed) {
      throw new BudgetExceededError('killed', 'task aborted by kill-switch')
    }
    if (this.limits.maxTokens !== undefined && this.tokens > this.limits.maxTokens) {
      throw new BudgetExceededError('tokens', `token budget exceeded: ${this.tokens} > ${this.limits.maxTokens}`)
    }
    if (this.limits.maxWallMs !== undefined && this.elapsedMs(now) > this.limits.maxWallMs) {
      throw new BudgetExceededError('wallclock', `wall-clock budget exceeded: ${this.elapsedMs(now)}ms > ${this.limits.maxWallMs}ms`)
    }
  }
}
