// @vitest-environment node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, expect, it } from 'vitest'
import { programOutputBytes, programStderrBytes, responseFrames, ResponseOutput, scriptFrameBytes } from '../../src/worker/runs/response'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const clean of cleanup.splice(0)) await clean() })
function decode(value: unknown) {
  const output = new ResponseOutput()
  let result: unknown
  for (const text of responseFrames('run', 'request', value, scriptFrameBytes)) {
    expect(Buffer.byteLength(text.trimEnd())).toBeLessThanOrEqual(scriptFrameBytes)
    const frame = JSON.parse(text)
    if (frame.outputPart !== undefined) output.append(frame.outputPart, frame.stream, frame.text)
    else result = output.finish(frame.value, frame.outputParts)
  }
  return result
}
it.each(['plain', 'unicode', 'escaped'])('delivers 32 MiB of %s stdout in bounded frames without changing bytes', (kind) => {
  const atom = kind === 'unicode' ? '😀' : kind === 'escaped' ? '\u0000' : 'x'
  const stdout = kind === 'unicode' ? `a${atom.repeat((programOutputBytes - 4) / 4)}xyz` : atom.repeat(programOutputBytes)
  const value = { stdout, stderr: '', exitCode: 7 }
  expect(decode(value)).toEqual(value)
})
it('keeps ordinary replies small and transports escaped stderr without exceeding a frame', () => {
  expect(decode({ stdout: 'small', stderr: '', exitCode: 0 })).toEqual({ stdout: 'small', stderr: '', exitCode: 0 })
  const value = { stdout: 'result', stderr: '\u0000'.repeat(programStderrBytes), exitCode: 1 }
  expect(decode(value)).toEqual(value)
  expect(decode({ pending: true })).toEqual({ pending: true })
})
it('rejects oversized output and malformed or incomplete chunk sequences', () => {
  expect(() => [...responseFrames('run', 'id', { stdout: 'x'.repeat(programOutputBytes + 1) }, scriptFrameBytes)]).toThrow('size limit')
  expect(() => [...responseFrames('run', 'id', { body: 'x'.repeat(scriptFrameBytes) }, scriptFrameBytes)]).toThrow('size limit')
  const output = new ResponseOutput()
  expect(() => output.append(1, 'stdout', 'x')).toThrow('Invalid')
  output.append(0, 'stdout', 'x')
  expect(() => output.append(0, 'stdout', 'x')).toThrow('Invalid')
  expect(() => output.finish({ stdout: '' }, 2)).toThrow('Incomplete')
  expect(() => output.finish({ stdout: '' }, undefined)).toThrow('Incomplete')
  expect(() => output.append(1, 'stderr', 'x'.repeat(programStderrBytes + 1))).toThrow('size limit')
})
it.each(['complete', 'truncated', 'failed'])('runs an actual script with a %s large memory reply', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'pods-memory-output-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const code = `export async function run(context) { const r = await context.tools.invoke({application:'fixture',argv:[]}); return {bytes:Buffer.byteLength(r.stdout),exitCode:r.exitCode}; }`
  const entry = join(root, 'run.mjs'); await writeFile(entry, code)
  const hash = createHash('sha256').update(code).digest('hex')
  const child = spawn(process.execPath, [resolve('src/worker/runs/script-entry.ts'), '--input-channel', entry, '', hash], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  const exited = new Promise<number | null>((done, reject) => { child.once('exit', done); child.once('error', reject) })
  cleanup.push(async () => { child.kill(); await exited })
  const channel = child.stdio[3] as Duplex
  channel.setEncoding('utf8')
  let diagnostics = ''; child.stderr?.on('data', (bytes) => { diagnostics += String(bytes) })
  const frames: Record<string, unknown>[] = []; let buffer = ''
  const output = '😀'.repeat(1024 * 1024)
  const serving = (async () => {
    for await (const bytes of channel) {
      buffer += String(bytes)
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); frames.push(frame)
        if (frame.type === 'request') {
          for (const reply of responseFrames('run', frame.id, { stdout: output, stderr: '', exitCode: 0 }, scriptFrameBytes)) {
            await new Promise<void>((done, reject) => channel.write(reply, error => error ? reject(error) : done()))
            if (mode === 'truncated') { channel.end(); break }
            if (mode === 'failed') { channel.write(`${JSON.stringify({ version: 1, runId: 'run', id: frame.id, ok: false, error: 'Cancelled output' })}\n`); break }
          }
        }
      }
    }
  })()
  channel.write(`${JSON.stringify({ version: 1, runId: 'run', scriptHash: hash, variables: {}, references: [], workspace: root, limits: { frameBytes: scriptFrameBytes } })}\n`)
  expect(await exited, diagnostics).toBe(mode === 'complete' ? 0 : 1)
  await serving
  if (mode === 'complete') expect(frames.at(-1)).toMatchObject({ type: 'result', payload: { bytes: Buffer.byteLength(output), exitCode: 0 } })
  else expect(frames.some(frame => frame.type === 'result')).toBe(false)
}, 15000)
