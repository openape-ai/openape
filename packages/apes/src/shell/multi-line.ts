import { spawnSync } from 'node:child_process'

/**
 * Result of checking whether a shell command buffer is syntactically
 * complete. The REPL uses this to decide whether to submit the line for
 * execution or to keep reading more lines with a continuation prompt.
 */
export type MultiLineStatus =
  | { kind: 'complete' }
  | { kind: 'continue' }
  | { kind: 'error', message: string }

/**
 * Patterns that bash writes to stderr when it encounters a syntax error
 * caused by an incomplete construct (missing `done`, unterminated quote,
 * unclosed `$(` or heredoc, etc.). If any of these patterns match, the
 * buffer is treated as incomplete and the REPL shows a continuation prompt
 * instead of reporting an error.
 */
const CONTINUE_PATTERNS: RegExp[] = [
  /syntax error: unexpected end of file/i,
  /unexpected end of file/i,
  /here-document.+delimited by end-of-file/i,
  /unexpected EOF while looking for matching/i,
]

/**
 * Detects an unterminated here-document in the buffer. `bash -n` accepts
 * these as "complete" (it treats end-of-input as the delimiter) so we have
 * to catch them ourselves to match interactive bash's behavior of showing
 * a continuation prompt until the user types the delimiter on its own line.
 *
 * Matches `<<` or `<<-` followed by an optionally-quoted identifier. For
 * each match we scan the remaining lines of the buffer for a line whose
 * content (after leading tabs, which `<<-` strips) equals the delimiter.
 * If no closing line is found, the heredoc is unterminated → continue.
 */
function hasUnterminatedHeredoc(buffer: string): boolean {
  // Match <<-? optional whitespace, optional ' or " around the word.
  // We deliberately don't try to parse bash quoting fully — this is a
  // best-effort heuristic that catches the common cases.
  const pattern = /<<(-?)\s*(['"]?)([A-Z_]\w*)\2/gi
  for (const match of buffer.matchAll(pattern)) {
    const stripTabs = match[1] === '-'
    const delimiter = match[3]!
    // Look at every line AFTER the match start
    const afterMatch = buffer.slice((match.index ?? 0) + match[0].length)
    const lines = afterMatch.split('\n').slice(1) // skip the rest of the opening line
    const terminated = lines.some((line) => {
      const compare = stripTabs ? line.replace(/^\t+/, '') : line
      return compare === delimiter
    })
    if (!terminated)
      return true
  }
  return false
}

/**
 * Check whether a (possibly multi-line) shell command buffer forms a
 * complete statement. Runs `bash -n -c <buffer>` in a separate process —
 * `-n` makes bash parse without executing, so there are no side effects.
 *
 * Design note: we spawn bash once per check. That's typically <10ms on
 * modern machines and only happens when the user presses Enter, not per
 * keystroke, so the cost is negligible.
 */
export function checkMultiLineStatus(buffer: string): MultiLineStatus {
  if (buffer.trim().length === 0)
    return { kind: 'complete' } // empty line is a no-op, treat as complete

  // Heredoc check first — bash -n accepts unterminated heredocs but an
  // interactive shell should ask for more input until the delimiter line.
  if (hasUnterminatedHeredoc(buffer))
    return { kind: 'continue' }

  const result = spawnSync('bash', ['-n', '-c', buffer], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf-8',
  })

  if (result.error) {
    // Bash itself couldn't be spawned — treat as a hard error so the REPL
    // can surface it. This should be vanishingly rare.
    return { kind: 'error', message: `Failed to spawn bash for syntax check: ${result.error.message}` }
  }

  if (result.status === 0)
    return { kind: 'complete' }

  const stderr = result.stderr || ''
  for (const pattern of CONTINUE_PATTERNS) {
    if (pattern.test(stderr))
      return { kind: 'continue' }
  }

  // Anything else is a genuine syntax error — caller should show it and
  // reset the buffer instead of accumulating more lines.
  return { kind: 'error', message: stderr.trim() || 'Syntax error' }
}
