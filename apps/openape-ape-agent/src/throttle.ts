// Trailing-edge throttle: invokes `fn` at most once per `intervalMs`,
// always firing the latest `pending()` value (whatever is current at
// fire time). Exposes `flush()` to force the trailing call and
// `cancel()` to drop it.

export interface Throttle {
  schedule: () => void
  flush: () => void
  cancel: () => void
}

export function createThrottle(fn: () => void | Promise<void>, intervalMs: number): Throttle {
  let timer: NodeJS.Timeout | undefined
  let pendingFlush = false
  let inFlight = false

  const fire = async () => {
    if (inFlight) {
      pendingFlush = true
      return
    }
    inFlight = true
    pendingFlush = false
    try {
      await fn()
    }
    finally {
      inFlight = false
      if (pendingFlush) {
        // Coalesce: if more schedule()s landed during the in-flight call,
        // run once more. Avoids losing the latest accumulator state.
        pendingFlush = false
        await fn()
      }
    }
  }

  return {
    schedule() {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        void fire()
      }, intervalMs)
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      void fire()
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}
