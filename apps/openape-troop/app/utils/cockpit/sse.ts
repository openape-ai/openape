/**
 * Stateful parser for the `data:`-only SSE stream our mock endpoint emits.
 * Feed decoded text chunks; get back the complete `data:` payloads found so
 * far. Events split across chunk boundaries are buffered until complete.
 */
export function createSseParser() {
  let buffer = ''
  return function push(chunk: string): string[] {
    buffer += chunk
    const out: string[] = []
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) out.push(line.slice(5).replace(/^ /, ''))
      }
      idx = buffer.indexOf('\n\n')
    }
    return out
  }
}
