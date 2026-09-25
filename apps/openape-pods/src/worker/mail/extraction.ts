import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentRuntime } from '../agent/executor'
import { launchSandbox, verifyExecutable } from '../runtime/sandbox'
import type { Extraction } from './parsers/extract'

export async function extractSource(runtime: AgentRuntime, root: string, source: Buffer, signal: AbortSignal, register: (path: string, ownerPid: number) => void): Promise<Extraction> {
  signal.throwIfAborted()
  const directory = join(root, `extract-${randomUUID()}`)
  await mkdir(directory, { mode: 0o700 })
  const input = join(directory, 'source.json'); const workspace = join(directory, 'workspace')
  await mkdir(workspace, { mode: 0o700 }); await writeFile(input, source, { mode: 0o400, flag: 'wx' })
  const base = dirname(runtime.entry); const entry = join(base, 'mail-parser.mjs'); const pdfWorker = join(base, 'pdf.worker.mjs')
  const hashes = JSON.parse(await readFile(join(base, 'parser-manifest.json'), 'utf8')) as Record<string, string>
  for (const path of [entry, pdfWorker]) await verifyExecutable(path, hashes[path === entry ? 'entry' : 'worker'])
  const domain = await launchSandbox(runtime.helper, directory, { executable: runtime.executable, workspace, readFiles: [input, entry, pdfWorker], runtimeDirectories: runtime.runtimeDirectories }, ['--max-old-space-size=192', entry, input, pdfWorker], runtime.environment, register)
  const stop = () => domain.cancel(); signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  let limited = false; let output = ''; let diagnosticBytes = 0
  const timeout = setTimeout(() => { limited = true; stop() }, 15000)
  domain.channel.setEncoding('utf8')
  domain.channel.on('data', (chunk: string) => { output += chunk; if (Buffer.byteLength(output) > 256 * 1024) { limited = true; stop() } })
  for (const stream of [domain.stdout, domain.stderr]) stream.on('data', (chunk: Buffer) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 64000) { limited = true; stop() } })
  try {
    await domain.processId
    const code = await domain.completed
    signal.throwIfAborted()
    if (code !== 0 || limited) return { text: '', gap: 'Parser failed or exceeded its process limit; source is unexamined', parser: `${hashes.entry}:${hashes.worker}` }
    const result = JSON.parse(output) as Extraction
    if (typeof result.text !== 'string' || result.text.length > 60000 || (result.gap !== null && (typeof result.gap !== 'string' || result.gap.length > 300)) || typeof result.parser !== 'string') throw new Error('Invalid parser result')
    return { ...result, parser: `${hashes.entry}:${hashes.worker}` }
  }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', stop); stop(); await domain.completed }
}
