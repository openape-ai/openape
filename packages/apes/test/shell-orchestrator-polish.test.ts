import { afterEach, describe, expect, it } from 'vitest'
import { PtyBridge } from '../src/shell/pty-bridge.js'

/**
 * M7 polish tests that exercise edge cases of the bash ↔ bridge wiring:
 *
 * - Commands whose output contains text that looks like a marker (should
 *   not confuse the detector — 16 hex bytes make collisions effectively
 *   impossible, but we verify the regex is narrow enough)
 * - Non-zero exit codes propagate correctly
 * - Rapid back-to-back commands don't lose ordering
 * - Large output (a few KB) streams through correctly
 */
describe('PtyBridge polish', () => {
  const bridges: PtyBridge[] = []

  afterEach(() => {
    for (const b of bridges) {
      try {
        b.kill()
      }
      catch {}
    }
    bridges.length = 0
  })

  async function makeBridge(): Promise<{
    bridge: PtyBridge
    output: string[]
    completed: Array<{ output: string, exitCode: number }>
  }> {
    const output: string[] = []
    const completed: Array<{ output: string, exitCode: number }> = []
    const bridge = new PtyBridge({
      onOutput: chunk => output.push(chunk),
      onLineDone: frame => completed.push({ output: frame.output, exitCode: frame.exitCode }),
      onExit: () => {},
    })
    bridges.push(bridge)
    await bridge.waitForReady()
    return { bridge, output, completed }
  }

  async function waitUntil(cond: () => boolean, ms = 5000) {
    const start = Date.now()
    while (!cond()) {
      if (Date.now() - start > ms)
        throw new Error('Timed out waiting for condition')
      await new Promise(r => setTimeout(r, 10))
    }
  }

  it('does not confuse a command that echoes __APES_ text in its output', async () => {
    const { bridge, completed } = await makeBridge()

    // Echo literal "__APES_" — the bridge's marker includes 32 random hex
    // chars so this must not match the regex.
    bridge.writeLine(`echo '__APES_fake_marker__:0:__END__'`)
    await waitUntil(() => completed.length >= 1)

    expect(completed[0]!.output).toContain('__APES_fake_marker__')
    expect(completed[0]!.exitCode).toBe(0)
  })

  it('propagates non-zero exit codes correctly', async () => {
    const { bridge, completed } = await makeBridge()

    bridge.writeLine('exit-code-test() { return 42; }; exit-code-test')
    await waitUntil(() => completed.length >= 1)

    expect(completed[0]!.exitCode).toBe(42)
  })

  it('preserves ordering when many commands run back-to-back', async () => {
    const { bridge, completed } = await makeBridge()

    for (let i = 0; i < 5; i++) {
      bridge.writeLine(`echo "line-${i}"`)
    }
    await waitUntil(() => completed.length >= 5)

    expect(completed).toHaveLength(5)
    for (let i = 0; i < 5; i++) {
      expect(completed[i]!.output).toContain(`line-${i}`)
    }
  })

  it('handles multi-kb output without losing data', async () => {
    const { bridge, completed } = await makeBridge()

    // Generate a predictable ~3KB of output via bash
    bridge.writeLine('for i in $(seq 1 100); do echo "payload-line-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; done')
    await waitUntil(() => completed.length >= 1)

    const out = completed[0]!.output
    expect(out).toContain('payload-line-1-')
    expect(out).toContain('payload-line-50-')
    expect(out).toContain('payload-line-100-')
    expect(completed[0]!.exitCode).toBe(0)
  })
})
