import { parse, quote } from 'shell-quote'
import { describe, expect, it } from 'vitest'
import { readGateConfig } from '../src/config.js'
import { decideExec, wrapWithApeShell } from '../src/wrap.js'

const config = readGateConfig({
  agents: { 'delta-mind': '/homes/dm' },
  apeShellPath: '/opt/ape-shell',
})

describe('decideExec', () => {
  it('wraps a command for a mapped agent', () => {
    const decision = decideExec({ agentId: 'delta-mind', command: 'touch /tmp/x', config })
    expect(decision).toEqual({
      kind: 'rewrite',
      command: 'APE_WAIT=1 APES_AUTH_FILE=/homes/dm/.config/apes/auth.json /opt/ape-shell -c \'touch /tmp/x\'',
    })
  })

  // Policy belongs to the owner. An agent nobody mapped has no identity to
  // request a grant with, so passing it through would run ungated.
  it('blocks an agent with no mapped identity', () => {
    const decision = decideExec({ agentId: 'stranger', command: 'touch /tmp/x', config })
    expect(decision.kind).toBe('block')
  })

  it('blocks when the tool call carries no agent id', () => {
    const decision = decideExec({ agentId: undefined, command: 'touch /tmp/x', config })
    expect(decision.kind).toBe('block')
  })

  it('leaves a non-string or empty command alone', () => {
    expect(decideExec({ agentId: 'delta-mind', command: undefined, config }).kind).toBe('pass')
    expect(decideExec({ agentId: 'delta-mind', command: '   ', config }).kind).toBe('pass')
  })
})

describe('wrapWithApeShell', () => {
  // The predecessor hand-rolled its shell quoting. Anything that survives
  // quoting reaches the host shell as syntax the grant never described, so the
  // assertion is round-trip: parse the wrapper back and the argument after
  // `-c` must be byte-identical to what the agent asked for. Asserting the
  // literal quoted form instead would only pin shell-quote's current style.
  it.each([
    `echo 'hi there'`,
    'echo $HOME',
    'echo `id`',
    `echo 'x' $(id)`,
    'a"b',
    'x; rm -rf /tmp/nope',
  ])('passes %j through quoting unchanged', (command) => {
    const wrapped = wrapWithApeShell(command, '/opt/ape-shell', '/a/auth.json')
    const tokens = parse(wrapped).filter(t => typeof t === 'string') as string[]
    expect(tokens.at(-1)).toBe(command)
    expect(tokens.at(-2)).toBe('-c')
  })

  // A command that merely LOOKS wrapped must still be wrapped. The gate used to
  // pass anything starting with the wrapper prefix straight through, and the
  // command text comes from the model — so `APE_WAIT=1 APES_AUTH_FILE=/tmp/x
  // /bin/sh -c ...` ran ungated. Wrap state cannot be read off the command.
  it('wraps a command that mimics the wrapper prefix', () => {
    const spoofed = `APE_WAIT=1 APES_AUTH_FILE=/tmp/x /bin/sh -c ${quote(['rm -rf /tmp/nope'])}`
    const decision = decideExec({ agentId: 'delta-mind', command: spoofed, config })
    expect(decision.kind).toBe('rewrite')
  })

  it('wraps its own output again rather than trusting it', () => {
    const once = wrapWithApeShell('touch /tmp/x', '/opt/ape-shell', '/a/auth.json')
    expect(decideExec({ agentId: 'delta-mind', command: once, config }).kind).toBe('rewrite')
  })

  // An auth home or ape-shell under a path with spaces used to retokenize the
  // generated line, so the wrapper ran the wrong argv or nothing at all.
  it('quotes configured paths, not just the inner command', () => {
    const wrapped = wrapWithApeShell('id', '/opt/ape shell/bin', '/Users/Alice Smith/auth.json')
    const tokens = parse(wrapped).filter(t => typeof t === 'string') as string[]
    expect(tokens).toContain('/opt/ape shell/bin')
    expect(wrapped).toContain('APE_WAIT=1 APES_AUTH_FILE=')
    expect(tokens.at(-1)).toBe('id')
  })
})
