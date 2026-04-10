import { afterEach, describe, expect, it } from 'vitest'
import { PtyBridge } from '../src/shell/pty-bridge.js'

/**
 * Drive a PtyBridge through a sequence of lines and collect everything the
 * callbacks emit. Helper to keep individual tests readable.
 */
function createHarness() {
  const outputChunks: string[] = []
  const completedLines: Array<{ output: string, exitCode: number }> = []
  let exitInfo: { exitCode: number, signal: number | undefined } | null = null

  const bridge = new PtyBridge({
    onOutput: chunk => outputChunks.push(chunk),
    onLineDone: frame => completedLines.push({ output: frame.output, exitCode: frame.exitCode }),
    onExit: (exitCode, signal) => { exitInfo = { exitCode, signal } },
  }, { cols: 120, rows: 30 })

  return {
    bridge,
    outputChunks,
    completedLines,
    get exitInfo() { return exitInfo },
  }
}

/**
 * Wait for a predicate to become true by polling every 10ms. Used because
 * pty data arrives asynchronously and we don't get deterministic events.
 */
async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for condition')
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('PtyBridge', () => {
  const harnesses: Array<ReturnType<typeof createHarness>> = []

  afterEach(() => {
    // Clean up all bash children spawned during tests
    for (const h of harnesses) {
      try {
        h.bridge.kill()
      }
      catch {}
    }
    harnesses.length = 0
  })

  it('reports ready once bash prints its first prompt marker', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    // By contract: no lines completed yet (bootstrap prompt is implicit),
    // and the marker was never visible in the output chunks.
    expect(h.completedLines).toEqual([])
    for (const chunk of h.outputChunks) {
      expect(chunk).not.toContain('__APES_')
      expect(chunk).not.toContain('__END__')
    }
  })

  it('executes a simple command and returns output + exit code', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    h.bridge.writeLine('echo hello-from-bash')
    await waitUntil(() => h.completedLines.length >= 1)

    expect(h.completedLines).toHaveLength(1)
    expect(h.completedLines[0]!.exitCode).toBe(0)
    expect(h.completedLines[0]!.output).toContain('hello-from-bash')
    // Marker must never appear in the output we hand to the consumer
    expect(h.completedLines[0]!.output).not.toContain('__APES_')
  })

  it('does not echo the written line back into the output stream', async () => {
    // The pty line discipline echoes input by default (canonical mode), so
    // without `stty -echo` the bash pty would reflect every line the
    // frontend writes. Real shells only echo once (their own readline),
    // ours already handles display in the REPL frontend, so the pty echo
    // is redundant and surprising. Verify PROMPT_COMMAND turns it off.
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    // Use a command whose input and output differ so we can tell them
    // apart. `whoami` prints one word, the input is another literal word.
    h.bridge.writeLine('APES_ECHO_PROBE_INPUT=1 printf "result\\n"')
    await waitUntil(() => h.completedLines.length >= 1)

    const out = h.completedLines[0]!.output
    // The command's actual output must be present.
    expect(out).toContain('result')
    // The literal input we wrote must NOT appear (no pty echo).
    expect(out).not.toContain('APES_ECHO_PROBE_INPUT')
  })

  it('persists shell state across lines (cd then pwd)', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    h.bridge.writeLine('cd /tmp')
    await waitUntil(() => h.completedLines.length >= 1)

    h.bridge.writeLine('pwd')
    await waitUntil(() => h.completedLines.length >= 2)

    expect(h.completedLines[1]!.exitCode).toBe(0)
    expect(h.completedLines[1]!.output).toContain('/tmp')
  })

  it('persists environment variables across lines', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    h.bridge.writeLine('export APES_TEST_FOO=bar')
    await waitUntil(() => h.completedLines.length >= 1)

    h.bridge.writeLine('echo "$APES_TEST_FOO"')
    await waitUntil(() => h.completedLines.length >= 2)

    expect(h.completedLines[1]!.exitCode).toBe(0)
    expect(h.completedLines[1]!.output).toContain('bar')
  })

  it('reports non-zero exit code when a command fails', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    h.bridge.writeLine('false')
    await waitUntil(() => h.completedLines.length >= 1)

    expect(h.completedLines[0]!.exitCode).toBe(1)
  })

  it('kill() terminates the bash child and fires onExit', async () => {
    const h = createHarness()
    harnesses.push(h)

    await h.bridge.waitForReady()
    h.bridge.kill()
    await waitUntil(() => h.exitInfo !== null)

    expect(h.exitInfo).not.toBeNull()
  })
})
