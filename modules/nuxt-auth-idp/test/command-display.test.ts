import { describe, expect, it } from 'vitest'
import { formatRequesterName, unwrapShellCommand } from '../src/runtime/utils/command-display'

describe('unwrapShellCommand', () => {
  it('unwraps the ape-shell bash -c transport to the inner line', () => {
    expect(unwrapShellCommand(['bash', '-c', 'o365-cli calendar today'])).toEqual({
      text: 'o365-cli calendar today',
      shell: 'bash',
    })
  })

  it('unwraps sh -lc and shells given by absolute path', () => {
    expect(unwrapShellCommand(['/bin/sh', '-lc', 'ls -la'])).toEqual({ text: 'ls -la', shell: 'sh' })
  })

  it('keeps flags between shell and -c out of the display', () => {
    expect(unwrapShellCommand(['bash', '--noprofile', '-c', 'echo hi'])).toEqual({ text: 'echo hi', shell: 'bash' })
  })

  it('leaves plain argv commands untouched', () => {
    expect(unwrapShellCommand(['exo', 'dns', 'show', 'example.com'])).toEqual({
      text: 'exo dns show example.com',
    })
  })

  it('does not unwrap a shell invocation without a -c script', () => {
    expect(unwrapShellCommand(['bash', 'deploy.sh'])).toEqual({ text: 'bash deploy.sh' })
    expect(unwrapShellCommand(['bash', 'deploy.sh', '-c', 'x'])).toEqual({ text: 'bash deploy.sh -c x' })
  })

  it('returns null for missing or empty commands', () => {
    expect(unwrapShellCommand()).toBeNull()
    expect(unwrapShellCommand([])).toBeNull()
  })
})

describe('formatRequesterName', () => {
  it('shows the agent slug for delegated agent emails', () => {
    expect(formatRequesterName('op-delta-mind-cb6bf26a+patrick+hofmann_eco@id.openape.ai'))
      .toBe('op-delta-mind-cb6bf26a')
  })

  it('keeps plain emails as-is', () => {
    expect(formatRequesterName('agent@example.com')).toBe('agent@example.com')
  })

  it('shortens opaque agent ids', () => {
    expect(formatRequesterName('agent:0123456789abcdef')).toBe('Agent 01234567…')
  })
})
