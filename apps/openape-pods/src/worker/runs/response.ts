export const scriptFrameBytes = 256 * 1024
export const programOutputBytes = 32 * 1024 * 1024
export const programStderrBytes = 64 * 1024
const chunkCharacters = 32 * 1024
const maximumOutputParts = 2048

type ReplyValue = Record<string, unknown> & { stdout: string }
function output(value: unknown): value is ReplyValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'stdout' in value && typeof value.stdout === 'string'
}

export function* responseFrames(runId: string, id: string, value: unknown, maximum: number): Generator<string> {
  const envelope = { version: 1, runId, id, ok: true }
  const encode = (body: object) => {
    const text = JSON.stringify({ ...envelope, ...body })
    if (Buffer.byteLength(text) > maximum) throw new Error('Runner response exceeds its size limit')
    return `${text}\n`
  }
  if (!output(value)) { yield encode({ value }); return }
  const stderr = typeof value.stderr === 'string' ? value.stderr : ''
  if (Buffer.byteLength(stderr) > programStderrBytes || Buffer.byteLength(value.stdout) + Buffer.byteLength(stderr) > programOutputBytes) throw new Error('Program output exceeds its size limit')
  const remainder = { ...value, stdout: '', ...(typeof value.stderr === 'string' ? { stderr: '' } : {}) }
  const final = encode({ value: remainder, outputParts: maximumOutputParts })
  if (final.length + (value.stdout.length + stderr.length) * 6 <= maximum) { yield encode({ value }); return }
  let part = 0
  for (const [stream, text] of [['stdout', value.stdout], ['stderr', stderr]] as const) {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + chunkCharacters, text.length)
      const last = text.charCodeAt(end - 1)
      if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--
      yield encode({ outputPart: part++, stream, text: text.slice(offset, end) })
      offset = end
    }
  }
  yield encode({ value: remainder, outputParts: part })
}

export class ResponseOutput {
  private chunks: { stdout: string[], stderr: string[] } = { stdout: [], stderr: [] }
  private bytes = 0
  private stderrBytes = 0
  private parts = 0

  append(part: unknown, stream: unknown, text: unknown): void {
    if (this.parts >= maximumOutputParts || part !== this.parts || (stream !== 'stdout' && stream !== 'stderr') || typeof text !== 'string' || !text.length) throw new Error('Invalid program output chunk')
    const size = Buffer.byteLength(text)
    this.bytes += size
    if (stream === 'stderr') this.stderrBytes += size
    if (this.bytes > programOutputBytes || this.stderrBytes > programStderrBytes) throw new Error('Program output exceeds its size limit')
    this.chunks[stream].push(text); this.parts++
  }

  finish(value: unknown, parts: unknown): unknown {
    if (parts === undefined && !this.parts) return value
    if (!Number.isSafeInteger(parts) || parts !== this.parts || !output(value) || value.stdout !== '' || (value.stderr !== undefined && value.stderr !== '')) throw new Error('Incomplete program output response')
    const result = { ...value, stdout: this.chunks.stdout.join(''), ...(value.stderr !== undefined || this.chunks.stderr.length ? { stderr: this.chunks.stderr.join('') } : {}) }
    this.chunks = { stdout: [], stderr: [] }; this.parts = 0; this.bytes = 0; this.stderrBytes = 0
    return result
  }
}
