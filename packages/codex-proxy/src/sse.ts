// Parse a stream of raw SSE text chunks into JSON event objects. Standard
// `data: <json>\n\n` framing; `[DONE]` and empty data are skipped; invalid JSON
// throws (a malformed Codex frame is a real error, not something to swallow).

function parseFrame(frame: string): unknown[] {
  const out: unknown[] = []
  for (const line of frame.split('\n')) {
    const trimmed = line.replace(/^\s+/, '')
    if (!trimmed.startsWith('data:'))
      continue
    const data = trimmed.slice('data:'.length).trim()
    if (!data || data === '[DONE]')
      continue
    out.push(JSON.parse(data))
  }
  return out
}

export async function* parseSSEEvents(chunks: AsyncIterable<string>): AsyncGenerator<unknown> {
  let buffer = ''
  for await (const chunk of chunks) {
    buffer += chunk
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const event of parseFrame(frame))
        yield event
      idx = buffer.indexOf('\n\n')
    }
  }
  for (const event of parseFrame(buffer))
    yield event
}
