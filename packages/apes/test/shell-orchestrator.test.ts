import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyBridge } from '../src/shell/pty-bridge.js'
import { ShellRepl } from '../src/shell/repl.js'

/**
 * Mini orchestrator that mirrors what `runInteractiveShell` does in the
 * real CLI entry point, but uses in-memory PassThrough streams for input
 * and output so tests can drive it deterministically. The real entry point
 * also wires raw-mode TTY forwarding and SIGWINCH, which we skip here
 * because there's no real TTY in tests.
 *
 * Each test gets its own bash pty so state can't leak between tests.
 */
function buildHarness() {
  const input = new PassThrough()
  const capturedOutput: string[] = []

  const output = new PassThrough()
  output.on('data', chunk => capturedOutput.push(chunk.toString()))

  let pendingResolve: ((exitCode: number) => void) | null = null

  const bridge = new PtyBridge({
    onOutput: (chunk) => {
      output.write(chunk)
    },
    onLineDone: (frame) => {
      const pending = pendingResolve
      pendingResolve = null
      if (pending)
        pending(frame.exitCode)
    },
    onExit: () => {},
  })

  const repl = new ShellRepl(
    {
      onLine: async (line) => {
        await new Promise<number>((resolve) => {
          pendingResolve = resolve
          bridge.writeLine(line)
        })
      },
      onExit: () => {
        try {
          bridge.kill()
        }
        catch {}
      },
    },
    {
      input,
      output,
      quiet: true,
    },
  )

  return {
    repl,
    bridge,
    input,
    output,
    capturedOutput,
    bridgeReady: () => bridge.waitForReady(),
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for condition')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('shell orchestrator (REPL + PtyBridge integration)', () => {
  const harnesses: Array<ReturnType<typeof buildHarness>> = []

  afterEach(() => {
    for (const h of harnesses) {
      try {
        h.bridge.kill()
      }
      catch {}
      try {
        h.repl.stop()
      }
      catch {}
    }
    harnesses.length = 0
  })

  it('executes a single command against bash and shows its output', async () => {
    const h = buildHarness()
    harnesses.push(h)

    await h.bridgeReady()
    const runPromise = h.repl.run()

    h.input.write('echo hello-from-shell\n')
    await waitUntil(() => h.capturedOutput.join('').includes('hello-from-shell'))

    h.input.end()
    await runPromise
  })

  it('persists shell state across sequential commands', async () => {
    const h = buildHarness()
    harnesses.push(h)

    await h.bridgeReady()
    const runPromise = h.repl.run()

    h.input.write('cd /tmp\n')
    // Wait for the cd to complete (first prompt after the line)
    await new Promise(r => setTimeout(r, 200))

    h.input.write('pwd\n')
    await waitUntil(() => h.capturedOutput.join('').includes('/tmp'))

    h.input.end()
    await runPromise
  })

  it('persists environment variables across lines', async () => {
    const h = buildHarness()
    harnesses.push(h)

    await h.bridgeReady()
    const runPromise = h.repl.run()

    h.input.write('export APES_ORCHESTRATOR_TEST=yes\n')
    await new Promise(r => setTimeout(r, 200))

    h.input.write('echo "value:$APES_ORCHESTRATOR_TEST"\n')
    await waitUntil(() => h.capturedOutput.join('').includes('value:yes'))

    h.input.end()
    await runPromise
  })

  it('handles multi-line for-loop via accumulation', async () => {
    const h = buildHarness()
    harnesses.push(h)

    await h.bridgeReady()
    const runPromise = h.repl.run()

    h.input.write('for i in a b c\n')
    await new Promise(r => setTimeout(r, 50))
    h.input.write('do\n')
    await new Promise(r => setTimeout(r, 50))
    h.input.write('  echo item:$i\n')
    await new Promise(r => setTimeout(r, 50))
    h.input.write('done\n')

    await waitUntil(() => {
      const out = h.capturedOutput.join('')
      return out.includes('item:a') && out.includes('item:b') && out.includes('item:c')
    })

    h.input.end()
    await runPromise
  })

  it('never leaks the prompt marker into visible output', async () => {
    const h = buildHarness()
    harnesses.push(h)

    await h.bridgeReady()
    const runPromise = h.repl.run()

    h.input.write('echo first\n')
    await new Promise(r => setTimeout(r, 200))
    h.input.write('echo second\n')
    await waitUntil(() => h.capturedOutput.join('').includes('second'))

    const all = h.capturedOutput.join('')
    expect(all).not.toContain('__APES_')
    expect(all).not.toContain('__END__')

    h.input.end()
    await runPromise
  })
})
