// A scheduler tick awaited a promise that never settled on September 25 (idle worker, no blocked
// syscall), which stopped all scheduling. Bounding each awaited step keeps scheduling alive.
const deadlineMark = Symbol('deadline')
export async function boundedStep<T>(limitMs: number, work: () => Promise<T>, expired: () => void): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof deadlineMark>((resolve) => { timer = setTimeout(resolve, limitMs, deadlineMark) })
  try {
    const result = await Promise.race([work(), deadline])
    if (result !== deadlineMark) return result as T
    expired()
    return undefined
  }
  finally { clearTimeout(timer) }
}
