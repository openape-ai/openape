import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellRepl } from '../src/shell/repl.js'

/**
 * Build a REPL wired to in-memory PassThrough streams so tests can drive
 * input line-by-line and inspect accumulated output. Writing to
 * `input.write(...)` simulates the user typing; `output` captures
 * everything the REPL prints (prompt, banners, echoes).
 */
function buildHarness() {
  const input = new PassThrough()
  const output = new PassThrough()
  const collectedOutput: string[] = []
  output.on('data', chunk => collectedOutput.push(chunk.toString()))

  const onLineCalls: string[] = []
  let exitCalls = 0

  const repl = new ShellRepl(
    {
      onLine: (line) => { onLineCalls.push(line) },
      onExit: () => { exitCalls++ },
    },
    {
      input,
      output,
      quiet: true,
    },
  )

  return {
    repl,
    input,
    output,
    collectedOutput,
    onLineCalls,
    get exitCalls() { return exitCalls },
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for condition')
    await new Promise(r => setTimeout(r, 5))
  }
}

describe('ShellRepl', () => {
  const harnesses: Array<ReturnType<typeof buildHarness>> = []

  afterEach(() => {
    for (const h of harnesses) {
      try {
        h.repl.stop()
      }
      catch {}
    }
    harnesses.length = 0
  })

  it('emits onLine for a simple single-line command', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()

    h.input.write('ls -la\n')
    await waitUntil(() => h.onLineCalls.length >= 1)

    expect(h.onLineCalls).toEqual(['ls -la'])

    h.input.end()
    await runPromise
    expect(h.exitCalls).toBe(1)
  })

  it('accumulates multi-line input until syntax is complete', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()

    // First line opens an unclosed for-loop — REPL should wait for more.
    h.input.write('for i in 1 2 3; do\n')
    // Give the REPL a tick to process
    await new Promise(r => setTimeout(r, 50))
    expect(h.onLineCalls).toEqual([])

    // Second line still inside the loop body.
    h.input.write('  echo $i\n')
    await new Promise(r => setTimeout(r, 50))
    expect(h.onLineCalls).toEqual([])

    // Closing line completes the structure.
    h.input.write('done\n')
    await waitUntil(() => h.onLineCalls.length >= 1)
    expect(h.onLineCalls).toHaveLength(1)
    expect(h.onLineCalls[0]).toContain('for i in 1 2 3; do')
    expect(h.onLineCalls[0]).toContain('echo $i')
    expect(h.onLineCalls[0]).toContain('done')

    h.input.end()
    await runPromise
  })

  it('accumulates multi-line input for an unterminated heredoc', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()

    h.input.write('cat << EOF\n')
    await new Promise(r => setTimeout(r, 50))
    expect(h.onLineCalls).toEqual([])

    h.input.write('hello\n')
    await new Promise(r => setTimeout(r, 50))
    expect(h.onLineCalls).toEqual([])

    h.input.write('EOF\n')
    await waitUntil(() => h.onLineCalls.length >= 1)
    expect(h.onLineCalls[0]).toContain('cat << EOF')
    expect(h.onLineCalls[0]).toContain('hello')
    expect(h.onLineCalls[0]).toContain('\nEOF')

    h.input.end()
    await runPromise
  })

  it('rejects a genuine syntax error and prints it without calling onLine', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()

    h.input.write('fi\n') // stray `fi` with no matching `if`
    await waitUntil(() => h.collectedOutput.join('').includes('unexpected'))

    expect(h.onLineCalls).toEqual([])

    h.input.end()
    await runPromise
  })

  it('skips whitespace-only lines without firing onLine', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()

    h.input.write('\n')
    h.input.write('   \n')
    await new Promise(r => setTimeout(r, 50))
    expect(h.onLineCalls).toEqual([])

    h.input.write('echo ok\n')
    await waitUntil(() => h.onLineCalls.length >= 1)
    expect(h.onLineCalls).toEqual(['echo ok'])

    h.input.end()
    await runPromise
  })

  it('calls onExit exactly once when input ends', async () => {
    const h = buildHarness()
    harnesses.push(h)
    const runPromise = h.repl.run()
    h.input.end()
    await runPromise
    expect(h.exitCalls).toBe(1)
  })

  it('onLine errors do not kill the REPL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const input = new PassThrough()
    const output = new PassThrough()
    const onLineCalls: string[] = []
    let throwNext = true

    const repl = new ShellRepl(
      {
        onLine: (line) => {
          onLineCalls.push(line)
          if (throwNext) {
            throwNext = false
            throw new Error('boom')
          }
        },
        onExit: () => {},
      },
      { input, output, quiet: true },
    )

    const runPromise = repl.run()
    input.write('ls\n')
    await waitUntil(() => onLineCalls.length >= 1)
    input.write('echo recovered\n')
    await waitUntil(() => onLineCalls.length >= 2)

    expect(onLineCalls).toEqual(['ls', 'echo recovered'])

    input.end()
    await runPromise
    errorSpy.mockRestore()
  })
})
