// Silent password input using raw-mode stdin. consola.prompt's `mask`
// option is honoured by some terminals (iTerm, Terminal.app) but ignored
// by others (Warp, some VT-emulator wrappers) — falling back to plain
// echoed text. Native readline with raw mode + manual character handling
// works uniformly: stdin is muted (no echo) and we render exactly what
// the user has come to expect from `sudo` / `ssh-keygen -p` / etc — the
// prompt label, no mask, just the trailing newline once Enter is hit.

import { CliError } from '../errors'

/**
 * Prompt for a password without echoing keystrokes. Resolves with the
 * typed string (without trailing newline). Throws `CliError` on Ctrl-C
 * / Ctrl-D / non-TTY stdin.
 */
export function readPasswordSilent(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new CliError(
      'No TTY available for the silent password prompt. '
      + 'Set APES_ADMIN_PASSWORD in the environment instead.',
    ))
  }
  return new Promise<string>((resolve, reject) => {
    process.stdout.write(prompt)
    const wasRaw = process.stdin.isRaw ?? false
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    let buf = ''
    let cleanupFn: (() => void) | undefined
    const cleanup = () => cleanupFn?.()
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (ch === '\r' || ch === '\n') {
          cleanup()
          process.stdout.write('\n')
          resolve(buf)
          return
        }
        if (code === 3) { // Ctrl-C
          cleanup()
          process.stdout.write('\n')
          reject(new CliError('Aborted by user (Ctrl-C).'))
          return
        }
        if (code === 4 && buf.length === 0) { // Ctrl-D on empty
          cleanup()
          process.stdout.write('\n')
          reject(new CliError('Aborted by user (Ctrl-D).'))
          return
        }
        if (code === 0x7F || code === 8) { // DEL / backspace
          if (buf.length > 0) buf = buf.slice(0, -1)
          continue
        }
        if (code < 32) continue // ignore other control chars
        buf += ch
      }
    }
    cleanupFn = () => {
      process.stdin.removeListener('data', onData)
      process.stdin.setRawMode(wasRaw)
      process.stdin.pause()
    }
    process.stdin.on('data', onData)
  })
}
