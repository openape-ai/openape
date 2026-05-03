import { describe, expect, it } from 'vitest'
import { readPasswordSilent } from '../src/lib/silent-password'

describe('readPasswordSilent', () => {
  it('rejects with a CliError when stdin has no TTY', async () => {
    // Vitest workers run without a controlling terminal, so stdin.isTTY is
    // already undefined/false. The helper must surface a clear hint that
    // points at APES_ADMIN_PASSWORD instead of stalling on the prompt.
    await expect(readPasswordSilent('Password: ')).rejects.toThrow(/APES_ADMIN_PASSWORD/)
  })
})
