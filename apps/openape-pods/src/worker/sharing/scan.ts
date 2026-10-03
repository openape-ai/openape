import type { PortableScanFinding } from '../../contracts/sharing'
import { createHash } from 'node:crypto'

export type { PortableScanFinding } from '../../contracts/sharing'

export interface PortableScanFile { path: string, content: Uint8Array, text: boolean, privateValues?: boolean }
const patterns: { kind: PortableScanFinding['kind'], severity: PortableScanFinding['severity'], pattern: RegExp }[] = [
  { kind: 'local-path', severity: 'block', pattern: /(?<![\w./-])(?:\/(?:Users|home|private|Volumes|tmp|var\/folders|Applications|opt|etc|usr\/local)\/[^\s"'<>]+|~\/[^\s"'<>]+|[A-Za-z]:\\[^\r\n"'<>]+)|file:\/\/\/[^\s"'<>]+/g },
  { kind: 'private-key', severity: 'block', pattern: /-----BEGIN (?:(?:RSA|DSA|EC|OPENSSH|ENCRYPTED) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/g },
  { kind: 'possible-credential', severity: 'review', pattern: /(?:\bAKIA[A-Z0-9]{16}\b|\bsk-[\w-]{20,}|\beyJ[\w-]{16,}\.[\w-]{16,}\.[\w-]{16,})/g },
  { kind: 'possible-credential', severity: 'review', pattern: /(?:bearer\s+[\w.~-]{16,}|(?:password|secret|token|api[_-]?key)\s*[=:]\s*["'][^"'\r\n]{16,}["']|[?&](?:token|api_key|secret|password)=[^&\s"']{8,})/gi },
]

function scanText(file: PortableScanFile): { source: string, opaque: boolean } {
  const sample = file.content.subarray(0, 256)
  const zeros = [0, 0]
  for (const [index, byte] of sample.entries()) {
    if (byte === 0) zeros[index % 2]!++
  }
  const encoding = !file.text && ((sample[0] === 0xFF && sample[1] === 0xFE) || (zeros[1]! > sample.length / 8 && zeros[0] === 0))
    ? 'utf-16le'
    : !file.text && ((sample[0] === 0xFE && sample[1] === 0xFF) || (zeros[0]! > sample.length / 8 && zeros[1] === 0)) ? 'utf-16be' : 'utf-8'
  try {
    const source = new TextDecoder(encoding, { fatal: true }).decode(file.content)
    return { source, opaque: !file.text && (source.includes('\0') || source.startsWith('%PDF-') || source.startsWith(String.fromCharCode(80, 75, 3, 4))) }
  }
  catch { return { source: new TextDecoder().decode(file.content), opaque: true } }
}

function* portableScanSteps(files: readonly PortableScanFile[], privateReferences: readonly string[], privateValues: readonly string[]): Generator<void, PortableScanFinding[]> {
  const findings: PortableScanFinding[] = []; const ids = new Set<string>()
  const references = Array.from(new Set(privateReferences.filter(value => value.length >= 4)), (value) => {
    const insensitive = /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|pod-app-[a-f0-9]{16})$/i.test(value)
    return { insensitive, needle: insensitive ? value.toLowerCase() : value }
  })
  const values = [...new Set(privateValues.filter(value => value.length >= 4))]
  for (const file of files) {
    const { source, opaque } = scanText(file)
    const lower = references.some(reference => reference.insensitive) ? source.toLowerCase() : source
    const add = (kind: PortableScanFinding['kind'], severity: PortableScanFinding['severity'], index: number) => {
      const id = createHash('sha256').update(JSON.stringify([file.path, kind, index])).digest('hex')
      if (ids.has(id)) return
      if (findings.length >= 200) throw new Error('Portable privacy scan has too many findings; reduce or parameterize the selected content')
      ids.add(id)
      let line: number | null = null
      if (file.text) {
        line = 1
        for (let position = 0; position < index; position++) {
          if (source.charCodeAt(position) === 10) line++
        }
      }
      findings.push({ id, path: file.path, line, kind, severity })
    }
    if (opaque) add('opaque-asset', 'review', 0)
    for (const { insensitive, needle } of references) {
      const haystack = insensitive ? lower : source
      let index = haystack.indexOf(needle)
      while (index !== -1) {
        add('local-reference', 'block', index)
        index = haystack.indexOf(needle, index + needle.length)
      }
      yield
    }
    for (const { kind, severity, pattern } of patterns) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) add(kind, severity, match.index)
      yield
    }
    if (file.privateValues === false) continue
    const word = /[\p{L}\p{N}_]/u
    for (const value of values) {
      let index = source.indexOf(value)
      while (index !== -1) {
        const before = source[index - 1] ?? ''; const after = source[index + value.length] ?? ''
        if ((!word.test(value[0]!) || !word.test(before)) && (!word.test(value.at(-1)!) || !word.test(after))) {
          add('private-value', 'review', index)
          break
        }
        index = source.indexOf(value, index + value.length)
      }
      yield
    }
  }
  return findings
}

export function scanPortableFiles(files: readonly PortableScanFile[], privateReferences: readonly string[], privateValues: readonly string[] = []): PortableScanFinding[] {
  const steps = portableScanSteps(files, privateReferences, privateValues)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

export async function scanPortableFilesAsync(files: readonly PortableScanFile[], privateReferences: readonly string[], privateValues: readonly string[] = []): Promise<PortableScanFinding[]> {
  const steps = portableScanSteps(files, privateReferences, privateValues)
  let step = steps.next()
  while (!step.done) {
    await new Promise<void>(resolve => setImmediate(resolve))
    step = steps.next()
  }
  return step.value
}
